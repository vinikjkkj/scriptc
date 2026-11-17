/* scr_str_census_walk.h — the half of the string census that can see ScrStr.
 *
 * scr_str_census.h is `-include`d and therefore processed BEFORE
 * scr_runtime.h, so `struct ScrStr` is incomplete there. This header is
 * included by scr_string.c from inside its own `#ifdef SCR_STRCEN_ON` block,
 * at a point where the type is complete. It holds:
 *
 *   - the constructor that stamps THIS BUILD's sizeof(ScrStr), offsetof(data),
 *     SCR_POOL_GRAIN and SCR_STR_CHAIN_SLACK into the report, so no
 *     per-string figure comes from a constant in the reader;
 *   - the ARM: SCR_STRCEN_ARM strings of a distinctive capacity, allocated in
 *     the constructor and never freed, so the reader can prove the hooks are
 *     live rather than reading a dead lane as an empty heap;
 *   - the WALK, which reads every live string's rc and payload.
 *
 * THE WALK ALLOCATES NOTHING. It is called from scr_strcen_born(), i.e. from
 * inside scr_str_alloc, and an allocation there would recurse. Its two tables
 * are static.
 */
#ifndef SCR_STR_CENSUS_WALK_H
#define SCR_STR_CENSUS_WALK_H

/* Content-hash table for the duplication count: 64-bit FNV-1a of (len,
 * bytes). A collision undercounts distinct strings; at 1.6M strings in a
 * 64-bit space the expected number is ~7e-8, and the table's own occupancy
 * overflow is counted and REFUSED on rather than silently truncating. */
static unsigned long long scr_strcen_htbl[SCR_STRCEN_HSLOTS];
/* Live multiplicity per occupied slot of the table above. Same index, so
 * the two are read together and neither can drift from the other. */
static unsigned scr_strcen_hcount[SCR_STRCEN_HSLOTS];

static unsigned long long scr_strcen_chash(const char *b, size_t n) {
  unsigned long long h = 1469598103934665603ULL;
  size_t i;
  for (i = 0; i < n; i++) {
    h ^= (unsigned char)b[i];
    h *= 1099511628211ULL;
  }
  h ^= n * 2654435761ULL;
  if (h == 0) h = 1; /* 0 is the empty-slot marker */
  return h;
}

/* The slot this content owns, inserting it if new; SCR_STRCEN_HSLOTS when
 * the table is full (which bumps hash_lost, which the reader refuses on).
 * *is_new is 1 exactly when the insert happened. */
static unsigned scr_strcen_hslot(unsigned long long h, int *is_new) {
  unsigned j = (unsigned)(h & (SCR_STRCEN_HSLOTS - 1u));
  unsigned i;
  for (i = 0; i < SCR_STRCEN_HSLOTS; i++) {
    unsigned k = (j + i) & (SCR_STRCEN_HSLOTS - 1u);
    if (scr_strcen_htbl[k] == 0) {
      scr_strcen_htbl[k] = h;
      *is_new = 1;
      return k;
    }
    if (scr_strcen_htbl[k] == h) { *is_new = 0; return k; }
  }
  scr_strcen_hash_lost++;
  *is_new = 0;
  return SCR_STRCEN_HSLOTS;
}

/* 1 when this content is NEW to the table. */
static int scr_strcen_hins(unsigned long long h) {
  int is_new = 0;
  unsigned k = scr_strcen_hslot(h, &is_new);
  if (k < SCR_STRCEN_HSLOTS) scr_strcen_hcount[k]++;
  return is_new;
}

/* PASS TWO: the contents with the highest live multiplicity, with a sample
 * of the bytes. It runs only after pass one has filled scr_strcen_hcount,
 * and it copies rather than pointing, because the strings it read are freed
 * long before the report is written. */
static void scr_strcen_walk_top(int w) {
  unsigned i;
  int j, k;
  long long cut = 0;
  for (j = 0; j < SCR_STRCEN_TOPN; j++) {
    scr_strcen_top[w][j].h = 0;
    scr_strcen_top[w][j].n = 0;
    scr_strcen_top[w][j].bytes = 0;
    scr_strcen_top[w][j].len = 0;
    scr_strcen_top[w][j].cap = 0;
    scr_strcen_top[w][j].sample[0] = '\0';
  }
  scr_strcen_top_n[w] = 0;
  /* Insertion sort into a TOPN-deep table, over the occupied slots. */
  for (i = 0; i < SCR_STRCEN_HSLOTS; i++) {
    long long c;
    if (scr_strcen_htbl[i] == 0) continue;
    c = (long long)scr_strcen_hcount[i];
    if (c <= cut) continue;
    for (j = 0; j < SCR_STRCEN_TOPN; j++) {
      if (c > scr_strcen_top[w][j].n) {
        for (k = SCR_STRCEN_TOPN - 1; k > j; k--) scr_strcen_top[w][k] = scr_strcen_top[w][k - 1];
        scr_strcen_top[w][j].h = scr_strcen_htbl[i];
        scr_strcen_top[w][j].n = c;
        scr_strcen_top[w][j].bytes = 0;
        scr_strcen_top[w][j].len = -1; /* no sample seen yet */
        scr_strcen_top[w][j].cap = 0;
        scr_strcen_top[w][j].sample[0] = '\0';
        break;
      }
    }
    cut = scr_strcen_top[w][SCR_STRCEN_TOPN - 1].n;
  }
  for (j = 0; j < SCR_STRCEN_TOPN; j++)
    if (scr_strcen_top[w][j].n > 0) scr_strcen_top_n[w] = j + 1;
  if (scr_strcen_top_n[w] == 0) return;
  /* The sample pass: one live string per top row is enough, and the FIRST
   * one found is taken, so the bytes belong to a string that really was
   * live in this population. */
  for (i = 0; i < SCR_STRCEN_PSLOTS; i++) {
    const ScrStr *s = (const ScrStr *)scr_strcen_ptbl[i];
    unsigned long long h;
    if (!s) continue;
    h = scr_strcen_chash(s->data, (size_t)s->len);
    for (j = 0; j < (int)scr_strcen_top_n[w]; j++) {
      if (scr_strcen_top[w][j].h != h) continue;
      scr_strcen_top[w][j].bytes +=
          scr_strcen_phys_of_req((long long)sizeof(ScrStr) + (long long)s->cap + 1);
      if (scr_strcen_top[w][j].len < 0) {
        size_t n = (size_t)s->len < (size_t)SCR_STRCEN_SAMPLE
                       ? (size_t)s->len : (size_t)SCR_STRCEN_SAMPLE;
        size_t q;
        for (q = 0; q < n; q++) {
          unsigned char c = (unsigned char)s->data[q];
          /* '|' would break the report's own delimiter; ' ' would break the
           * field split. Both are escaped, and so is everything unprintable. */
          scr_strcen_top[w][j].sample[q] =
              (c >= 0x21 && c < 0x7f && c != '|') ? (char)c : '.';
        }
        scr_strcen_top[w][j].sample[n] = '\0';
        scr_strcen_top[w][j].len = (long long)s->len;
        scr_strcen_top[w][j].cap = (long long)s->cap;
      }
      break;
    }
  }
}


#include <fcntl.h>
#include <unistd.h>

/* ── the large-string ledger, the arena-chunk ledger and the holder scan ── */

/* Which arena chunk (index into scr_str_ar_index) a block pointer is in, or -1. */
static long scr_strcen_chunk_idx(const void *p) {
  size_t lo = 0, hi = scr_str_ar_nindex;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2u;
    const unsigned char *base = (const unsigned char *)(const void *)scr_str_ar_index[mid];
    if ((const unsigned char *)p < base) { hi = mid; continue; }
    if ((const unsigned char *)p >= base + SCR_STR_ARENA_CHUNK) { lo = mid + 1u; continue; }
    return (long)mid;
  }
  return -1;
}

static void scr_strcen_chunks(int w) {
  long i, n = (long)scr_str_ar_nindex;
  int c;
  if (n > SCR_STRCEN_CHUNKN) n = SCR_STRCEN_CHUNKN;
  scr_strcen_chunk_n[w] = n;
  for (i = 0; i < n; i++) {
    ScrStrCenChunk *k = &scr_strcen_chunk[w][i];
    k->base = scr_str_ar_index[i];
    k->carved = (long long)scr_str_ar_index[i]->carved;
    k->live_n = k->live_bytes = k->free_n = k->free_bytes = 0;
  }
  /* the live strings, from the census's own pointer table */
  for (i = 0; i < (long)SCR_STRCEN_PSLOTS; i++) {
    const ScrStr *s = (const ScrStr *)scr_strcen_ptbl[i];
    long ci;
    if (!s) continue;
    ci = scr_strcen_chunk_idx(s);
    if (ci < 0 || ci >= n) continue;
    scr_strcen_chunk[w][ci].live_n++;
    scr_strcen_chunk[w][ci].live_bytes += (long long)scr_pool_bytes(sizeof(ScrStr) + (size_t)s->cap + 1u);
  }
  /* the blocks the arena's own free lists hold */
  for (c = 1; c <= SCR_POOL_CLASSES; c++) {
    void *b = scr_str_ar_free[c];
    while (b != NULL) {
      long ci = scr_strcen_chunk_idx(b);
      if (ci >= 0 && ci < n) {
        scr_strcen_chunk[w][ci].free_n++;
        scr_strcen_chunk[w][ci].free_bytes += (long long)c * (long long)SCR_POOL_GRAIN;
      }
      { void *nx; __builtin_memcpy(&nx, b, sizeof nx); b = nx; }
    }
  }
}

/* A tiny open-addressing set of the addresses the scan looks for. */
#define SCR_STRCEN_TSET 512u
static unsigned long long scr_strcen_tset_k[SCR_STRCEN_TSET];
static unsigned short scr_strcen_tset_v[SCR_STRCEN_TSET];
static void scr_strcen_tset_add(unsigned long long k, unsigned short v) {
  unsigned j = (unsigned)((k * 0x9E3779B97F4A7C15ULL) >> 40) & (SCR_STRCEN_TSET - 1u);
  for (unsigned t = 0; t < SCR_STRCEN_TSET; t++, j = (j + 1u) & (SCR_STRCEN_TSET - 1u)) {
    if (scr_strcen_tset_k[j] == 0) { scr_strcen_tset_k[j] = k; scr_strcen_tset_v[j] = v; return; }
    if (scr_strcen_tset_k[j] == k) return;
  }
}
static int scr_strcen_tset_find(unsigned long long k) {
  unsigned j = (unsigned)((k * 0x9E3779B97F4A7C15ULL) >> 40) & (SCR_STRCEN_TSET - 1u);
  for (unsigned t = 0; t < SCR_STRCEN_TSET; t++, j = (j + 1u) & (SCR_STRCEN_TSET - 1u)) {
    if (scr_strcen_tset_k[j] == k) return (int)scr_strcen_tset_v[j];
    if (scr_strcen_tset_k[j] == 0) return -1;
  }
  return -1;
}

static char scr_strcen_maps_buf[1 << 18];

/* Word scan of every readable-writable mapping for a pointer to one of the large strings of walk `w`
 * (the string address itself, or its data[] address). The census's own tables are excluded by address, and so is this
 * function's frame. Allocates nothing. Region codes: 1 [heap], 2 anonymous mmap, 3 file-backed (binary data/bss or a
 * library), 4 [stack]. */
static void scr_strcen_holders(int w) {
  int fd = open("/proc/self/maps", O_RDONLY);
  long n = 0, got;
  char *b = scr_strcen_maps_buf, *q, *end;
  unsigned long long skip_lo[6], skip_hi[6];
  unsigned long long fr = (unsigned long long)(size_t)__builtin_frame_address(0);
  int nskip = 0, j;
  unsigned long long off = (unsigned long long)scr_strcen_off_data;
  scr_strcen_scan_bytes[w] = scr_strcen_scan_hits[w] = scr_strcen_scan_regions[w] = 0;
  if (fd < 0) return;
  while ((got = (long)read(fd, b + n, sizeof scr_strcen_maps_buf - 1 - (size_t)n)) > 0) n += got;
  close(fd);
  b[n] = '\0';
  memset(scr_strcen_tset_k, 0, sizeof scr_strcen_tset_k);
  for (j = 0; j < (int)scr_strcen_big_n[w]; j++) {
    unsigned long long a = (unsigned long long)(size_t)scr_strcen_big[w][j].p;
    scr_strcen_big[w][j].nhold = 0;
    scr_strcen_tset_add(a, (unsigned short)j);
    scr_strcen_tset_add(a + off, (unsigned short)j);
  }
#define SCR_STRCEN_SKIP(x) do { skip_lo[nskip] = (unsigned long long)(size_t)&(x); skip_hi[nskip] = skip_lo[nskip] + sizeof(x); nskip++; } while (0)
  SCR_STRCEN_SKIP(scr_strcen_ptbl);
  SCR_STRCEN_SKIP(scr_strcen_htbl);
  SCR_STRCEN_SKIP(scr_strcen_hcount);
  SCR_STRCEN_SKIP(scr_strcen_big);
  SCR_STRCEN_SKIP(scr_strcen_tset_k);
  SCR_STRCEN_SKIP(scr_strcen_top);
  for (q = b; q < b + n; q = end + 1) {
    unsigned long long lo = 0, hi = 0, a;
    char *p = q;
    int region;
    end = strchr(q, '\n');
    if (!end) end = b + n;
    for (; *p && *p != '-'; p++) { int d = *p <= '9' ? *p - '0' : (*p | 32) - 'a' + 10; lo = lo * 16u + (unsigned)d; }
    if (*p == '-') p++;
    for (; *p && *p != ' '; p++) { int d = *p <= '9' ? *p - '0' : (*p | 32) - 'a' + 10; hi = hi * 16u + (unsigned)d; }
    while (*p == ' ') p++;
    if (!(p[0] == 'r' && p[1] == 'w')) continue;
    { /* skip to the path: perms, offset, dev, inode */
      int f; char *r = p;
      for (f = 0; f < 4 && r < end; f++) { while (r < end && *r != ' ') r++; while (r < end && *r == ' ') r++; }
      if (r < end && *r == '[') {
        if (r[1] == 'h') region = 1; else if (r[1] == 's') region = 4; else continue; /* vvar, vsyscall */
      } else if (r < end && *r == '/') region = 3;
      else region = 2;
    }
    scr_strcen_scan_regions[w]++;
    for (a = lo; a + 8 <= hi; a += 8) {
      unsigned long long v = *(const unsigned long long *)(size_t)a;
      int t, k;
      if (v < 4096ULL) continue;
      t = scr_strcen_tset_find(v);
      if (t < 0) continue;
      for (k = 0; k < nskip; k++) if (a >= skip_lo[k] && a < skip_hi[k]) break;
      if (k < nskip) continue;
      if (a + 4096ULL > fr - 8192ULL && a < fr + 8192ULL) continue; /* this function's own frame */
      scr_strcen_scan_hits[w]++;
      {
        ScrStrCenBig *bg = &scr_strcen_big[w][t];
        unsigned h = bg->nhold++;
        if (h < 4) {
          bg->hold[h] = a;
          bg->holdr[h] = (unsigned char)region;
          if (a >= lo + 24 && a + 24 <= hi) memcpy(bg->hctx[h], (const void *)(size_t)(a - 24), 48);
          else memset(bg->hctx[h], 0, 48);
        }
      }
    }
    scr_strcen_scan_bytes[w] += (long long)(hi - lo);
  }
#undef SCR_STRCEN_SKIP
}

static void scr_strcen_walk(int final) {
  unsigned i;
  int w = final ? 1 : 0;
  long long n = 0, rcsum = 0, rcmax = 0, distinct = 0, dupb = 0, ascii = 0, phys = 0;
  long long lensum = 0, lenmax = 0;
  memset(scr_strcen_htbl, 0, sizeof scr_strcen_htbl);
  memset(scr_strcen_hcount, 0, sizeof scr_strcen_hcount);
  for (i = 0; i < SCR_STRCEN_RCROWS; i++) scr_strcen_walk_rc[w][i] = 0;
  scr_strcen_odd_n[w] = 0;
  scr_strcen_big_n[w] = scr_strcen_big_all_n[w] = scr_strcen_big_all_phys[w] = scr_strcen_big_shared[w] = 0;
  for (i = 0; i < SCR_STRCEN_PSLOTS; i++) {
    const ScrStr *s = (const ScrStr *)scr_strcen_ptbl[i];
    long long cap, len, p;
    unsigned long long rc;
    size_t j;
    int pure = 1;
    if (!s) continue;
    rc = (unsigned long long)s->rc;
    cap = (long long)s->cap;
    len = (long long)s->len;
    if (cap > (1LL << 30) || len > cap) {
      /* NOT a capacity: a tag, or a string whose header the census books never saw change. Counted and sampled, not priced. */
      if (scr_strcen_odd_n[w] == 0) {
        size_t q, m = (size_t)s->len < 40u ? (size_t)s->len : 40u;
        scr_strcen_odd_len[w] = len; scr_strcen_odd_cap[w] = cap; scr_strcen_odd_rc[w] = (long long)rc;
        for (q = 0; q < m; q++) { unsigned char c = (unsigned char)s->data[q]; scr_strcen_odd_sample[w][q] = (c >= 0x21 && c < 0x7f && c != '|') ? (char)c : '.'; }
        scr_strcen_odd_sample[w][m] = '\0';
      }
      scr_strcen_odd_n[w]++;
      n++;
      rcsum += (long long)rc;
      continue;
    }
    p = scr_strcen_phys_of_req((long long)sizeof(ScrStr) + cap + 1);
    n++;
    phys += p;
    rcsum += (long long)rc;
    if ((long long)rc > rcmax) rcmax = (long long)rc;
    lensum += len;
    if (len > lenmax) lenmax = len;
    scr_strcen_walk_rc[w][scr_strcen_rcrow(rc)]++;
    for (j = 0; j < (size_t)len; j++) {
      if ((unsigned char)s->data[j] >= 0x80) { pure = 0; break; }
    }
    if (pure) ascii++;
    {
      unsigned long long hh = scr_strcen_chash(s->data, (size_t)len);
      if (scr_strcen_hins(hh)) distinct++;
      else dupb += p;
      if (scr_pool_bytes(sizeof(ScrStr) + (size_t)cap + 1u) > SCR_POOL_MAX) {
        int q, pos = -1;
        scr_strcen_big_all_n[w]++;
        scr_strcen_big_all_phys[w] += p;
        if (rc > 1) scr_strcen_big_shared[w]++;
        for (q = 0; q < (int)scr_strcen_big_n[w]; q++) if (p > scr_strcen_big[w][q].phys) { pos = q; break; }
        if (pos < 0 && scr_strcen_big_n[w] < SCR_STRCEN_BIGN) pos = (int)scr_strcen_big_n[w];
        if (pos >= 0) {
          int k2;
          size_t m = (size_t)len < 40u ? (size_t)len : 40u, z;
          int top = scr_strcen_big_n[w] < SCR_STRCEN_BIGN ? (int)scr_strcen_big_n[w] : SCR_STRCEN_BIGN - 1;
          for (k2 = top; k2 > pos; k2--) scr_strcen_big[w][k2] = scr_strcen_big[w][k2 - 1];
          scr_strcen_big[w][pos].p = s; scr_strcen_big[w][pos].len = len; scr_strcen_big[w][pos].cap = cap;
          scr_strcen_big[w][pos].rc = (long long)rc; scr_strcen_big[w][pos].phys = p; scr_strcen_big[w][pos].h = hh;
          scr_strcen_big[w][pos].nhold = 0;
          for (z = 0; z < m; z++) { unsigned char c = (unsigned char)s->data[z]; scr_strcen_big[w][pos].sample[z] = (c >= 0x21 && c < 0x7f && c != '|') ? (char)c : '.'; }
          scr_strcen_big[w][pos].sample[m] = '\0';
          if (scr_strcen_big_n[w] < SCR_STRCEN_BIGN) scr_strcen_big_n[w]++;
        }
      }
    }
  }
  scr_strcen_walks++;
  scr_strcen_walk_n[w] = n;
  scr_strcen_walk_at_n[w] = scr_strcen_live_n;
  scr_strcen_walk_rc_sum[w] = rcsum;
  scr_strcen_walk_rc_max[w] = rcmax;
  scr_strcen_walk_distinct[w] = distinct;
  scr_strcen_walk_dup_bytes[w] = dupb;
  scr_strcen_walk_ascii[w] = ascii;
  scr_strcen_walk_phys[w] = phys;
  scr_strcen_walk_len_sum[w] = lensum;
  scr_strcen_walk_len_max[w] = lenmax;
  scr_strcen_walk_at_phys[w] = scr_strcen_live_phys;
  scr_strcen_walk_top(w);
  scr_strcen_chunks(w);
  /* The holder scan is O(mapped memory), so it runs on the final walk only; the large strings at exit are the large
   * strings at the end of the run, and the reader prints that scope beside the result. */
  if (final) scr_strcen_holders(w);
}

static void scr_strcen_walk_peak(void) { scr_strcen_walk(0); }

/* The arm: a population the reader knows the exact shape of. Capacity 251 is
 * chosen because it is inside the exact-row band, is not a multiple of the
 * pool grain, and no real allocation in this runtime asks for it — so a row
 * at 251 holding anything other than the arm is itself a finding. The
 * strings are leaked on purpose; the reader subtracts them. */
#ifndef SCR_STRCEN_ARM
#define SCR_STRCEN_ARM 0
#endif
#define SCR_STRCEN_ARM_CAP 251

__attribute__((constructor)) static void scr_strcen_walk_install(void) {
  static int done = 0;
  int i;
  if (done) return;
  done = 1;
  scr_strcen_sizeof_str = (long long)sizeof(ScrStr);
  scr_strcen_off_data = (long long)offsetof(ScrStr, data);
  scr_strcen_pool_grain = (long long)SCR_POOL_GRAIN;
  scr_strcen_chain_slack = (long long)SCR_STR_CHAIN_SLACK;
  scr_strcen_walk_fn = scr_strcen_walk;
  scr_strcen_walk_hook = scr_strcen_walk_peak;
  scr_strcen_arm_cap = SCR_STRCEN_ARM_CAP;
  for (i = 0; i < SCR_STRCEN_ARM; i++) {
    ScrStr *s = scr_str_alloc(0, SCR_STRCEN_ARM_CAP);
    s->data[0] = '\0';
    scr_strcen_arm_n++;
    (void)s; /* deliberately leaked: the arm must be live at every peak */
  }
}

#endif /* SCR_STR_CENSUS_WALK_H */
