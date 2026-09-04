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

static void scr_strcen_walk(int final) {
  unsigned i;
  int w = final ? 1 : 0;
  long long n = 0, rcsum = 0, rcmax = 0, distinct = 0, dupb = 0, ascii = 0, phys = 0;
  long long lensum = 0, lenmax = 0;
  memset(scr_strcen_htbl, 0, sizeof scr_strcen_htbl);
  memset(scr_strcen_hcount, 0, sizeof scr_strcen_hcount);
  for (i = 0; i < SCR_STRCEN_RCROWS; i++) scr_strcen_walk_rc[w][i] = 0;
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
    if (scr_strcen_hins(scr_strcen_chash(s->data, (size_t)len))) distinct++;
    else dupb += p;
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
  scr_strcen_walk_top(w);
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
