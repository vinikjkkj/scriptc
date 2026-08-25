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

/* 1 when this content is NEW to the table. */
static int scr_strcen_hins(unsigned long long h) {
  unsigned j = (unsigned)(h & (SCR_STRCEN_HSLOTS - 1u));
  unsigned i;
  for (i = 0; i < SCR_STRCEN_HSLOTS; i++) {
    unsigned k = (j + i) & (SCR_STRCEN_HSLOTS - 1u);
    if (scr_strcen_htbl[k] == 0) { scr_strcen_htbl[k] = h; return 1; }
    if (scr_strcen_htbl[k] == h) return 0;
  }
  scr_strcen_hash_lost++;
  return 0;
}

static void scr_strcen_walk(int final) {
  unsigned i;
  int w = final ? 1 : 0;
  long long n = 0, rcsum = 0, rcmax = 0, distinct = 0, dupb = 0, ascii = 0, phys = 0;
  long long lensum = 0, lenmax = 0;
  memset(scr_strcen_htbl, 0, sizeof scr_strcen_htbl);
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
