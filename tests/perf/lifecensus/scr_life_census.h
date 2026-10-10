/* scr_life_census.h — DOES TYPE PREDICT LIFETIME, and are the long-lived
 * dense enough to fill a chunk?
 *
 * THE QUESTION THIS ANSWERS AND THE ONE IT REFUSES TO.  tests/perf/cycensus
 * keys every cycle object on its `ScrCycFreeFn` — the object KIND, exactly,
 * 1,434 distinct ones in zapo's emitted TU — and reports what is LIVE.  It
 * cannot say how long anything lived, and it cannot say which chunk a
 * survivor is pinning.  Those two are this header.
 *
 *   A SURVIVOR IS NOT A PINNER.  What holds a 64 KiB chunk is the object
 *   that is ALONE in it.  A by-type census over all survivors answers the
 *   wrong question, so the population this header reports is, per chunk the
 *   arena STILL HOLDS, what is actually in it — joined back to the kind and
 *   the allocation site of every one of those blocks.
 *
 * THE CLOCK IS THE ALLOCATION ORDINAL, NOT WALL TIME.  `scr_life_seq` counts
 * cycle allocations; a lifetime is a difference of two ordinals.  Wall time
 * on a loaded box is a draw and a sweep index is too coarse to separate a
 * decile.  The mutator clock is deterministic for a deterministic workload
 * and is unaffected by another process on the machine, which is the only
 * reason a reading taken while something else builds can be believed.
 * `scr_life_bytes` is the same clock in bytes, reported beside it.
 *
 * THE TWO KEYS, both already free at the allocation site:
 *   KIND   the ScrCycFreeFn — cycensus's key, exact per cycle-graded shape.
 *   SITE   __builtin_return_address(0) in scr_cyc_alloc — the function that
 *          asked.  Reported as a raw address plus the address of one anchor
 *          symbol, so the reader subtracts and symbolises against the PDB;
 *          this header needs no platform header and cannot reopen
 *          scr_prof.h's `fd_set` collision.
 *
 * HOW A PREDICTOR IS SCORED, and it is not a histogram eyeball.  Every death
 * contributes L = 256*log2(lifetime+1) in fixed point.  Each group (by kind,
 * by site, by the kind×site pair) accumulates n, sum(L), sum(L^2).  The
 * fraction of the variance of L explained by a key is
 *     R^2 = 1 - (sum over groups of within-group SS) / (total SS)
 * which is computable from exactly those three numbers and needs no
 * per-object storage.  "Site beats type" is then a comparison of two R^2 on
 * ONE population, not two separate stories.
 *
 * WHAT IT COSTS, stated because the instrument lands inside the system it
 * measures.  Everything here is BSS: see the SELFTEST line's `tableBytes`,
 * which is printed on every reading.  Nothing is allocated from the CRT heap
 * and nothing changes the arena's geometry — no field is added to ScrCycHdr,
 * no stride moves, no chunk is carved differently.  The control for that
 * claim is a second build with this header absent: the page census's chunk
 * and free-page histogram must be identical.
 *
 * ARMING
 *   SCRIPTC_PROF_CFLAGS="-include .../tests/perf/pagecensus/scr_page_census.h
 *                        -DSCR_PAGECEN_ON
 *                        -include .../tests/perf/lifecensus/scr_life_census.h
 *                        -DSCR_LIFECEN_ON"
 *   SCR_LIFECEN_OUT    file for the report; absent, stderr.
 *   SCR_LIFECEN_BLOCKS 1 = also dump one line per LIVE BLOCK in every held
 *                      chunk (kind, site, birth).  That file is the pinner
 *                      population itself; the summary is derived from it.
 *
 * SCR_PAGECEN_ON IS REQUIRED and this header static-asserts nothing about
 * it — scr_cycle.c does.  The chunk walk is the page census's: one list, one
 * traversal, and this header's live count is reconciled against
 * `scr_pc_live_slots` on every reading, so two independent walks of the same
 * chunks have to agree or the report says SELFTEST FAILED.
 *
 * IT REFUSES TO REPORT A SILENT ZERO.  ARMED prints unconditionally.
 * NO CHUNKS prints by name.  NO DEATHS prints by name.  The exit route is
 * both atexit AND the _Exit interposer, because these PE images run no .CRT
 * teardown and process.exit() lowers to _Exit — an atexit-only census
 * compiles in and never runs.
 */
#ifndef SCR_LIFE_CENSUS_H
#define SCR_LIFE_CENSUS_H

#ifdef SCR_LIFECEN_ON

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SCR_LIFE_SHARED __attribute__((selectany))
#define SCR_LIFE_FN \
  static __attribute__((unused)) __attribute__((no_instrument_function))

/* The anchor the reader subtracts to get an RVA.  Declared, not included:
 * this header is -include'd before scr_runtime.h.  Matches scr_runtime.h. */
void scr_collect_cycles(void);

#ifndef SCR_LIFE_KSLOTS
#define SCR_LIFE_KSLOTS 8192u /* kinds: zapo's TU has ~1,452 */
#endif
#ifndef SCR_LIFE_SSLOTS
#define SCR_LIFE_SSLOTS 8192u /* sites: scr_cyc_alloc has ~1,451 callers */
#endif
#ifndef SCR_LIFE_PAIRSLOTS
#define SCR_LIFE_PAIRSLOTS 32768u
#endif
/* A ceiling on SIMULTANEOUSLY LIVE cycle objects.  cycensus sized its own at
 * 2^18 for "zapo holds ~78,000"; this one is 2^20 because that figure is
 * from the retired memory-store arm and an overflow here silently loses the
 * birth of exactly the objects most likely to be survivors.  Overflow bumps
 * scr_life_ptr_lost, which the report prints and the reader refuses on. */
#ifndef SCR_LIFE_PSLOTS
#define SCR_LIFE_PSLOTS (1u << 20)
#endif
#define SCR_LIFE_HB 40u /* log2 buckets of lifetime, in allocations */
#define SCR_LIFE_NOROW 0xffffu

typedef struct {
  const void *key; /* free_fn, or the return address.  NULL = empty. */
  long long n_alloc;
  long long n_dead;
  long long bytes_ever;
  /* the variance accumulators over L = 256*log2(life+1) */
  long long l_sum, l_sumsq;
  long long l_min, l_max;
  /* survivors at the exit reading */
  long long n_live, live_phys;
  long long live_l_sum; /* censored lifetimes of those survivors */
  /* pinners: survivors found inside a chunk the arena still held */
  long long n_pin, n_pin_sole, n_pin_le2;
  long long pin_share_bytes; /* sum over pinners of chunkbytes/chunklive */
  unsigned long long hist[SCR_LIFE_HB];
} ScrLifeRow;

typedef struct {
  unsigned short kind, site; /* row indices; SCR_LIFE_NOROW = none */
  unsigned short used;
  unsigned short pad_;
  long long n_alloc, n_dead;
  long long l_sum, l_sumsq;
  long long n_live, n_pin;
} ScrLifePair;

typedef struct {
  const void *p; /* the HEADER address.  NULL = empty; no tombstones. */
  unsigned birth; /* allocation ordinal */
  unsigned phys;
  unsigned short kind, site;
} ScrLifePtr;

SCR_LIFE_SHARED ScrLifeRow scr_life_kind[SCR_LIFE_KSLOTS] = {{0}};
SCR_LIFE_SHARED ScrLifeRow scr_life_site[SCR_LIFE_SSLOTS] = {{0}};
SCR_LIFE_SHARED ScrLifePair scr_life_pair[SCR_LIFE_PAIRSLOTS] = {{0}};
SCR_LIFE_SHARED ScrLifePtr scr_life_ptbl[SCR_LIFE_PSLOTS] = {{0}};
SCR_LIFE_SHARED unsigned scr_life_korder[SCR_LIFE_KSLOTS] = {0};
SCR_LIFE_SHARED unsigned scr_life_sorder[SCR_LIFE_SSLOTS] = {0};
SCR_LIFE_SHARED unsigned scr_life_porder[SCR_LIFE_PAIRSLOTS] = {0};
SCR_LIFE_SHARED long long scr_life_nkind = 0, scr_life_nsite = 0;
SCR_LIFE_SHARED long long scr_life_npair = 0;
SCR_LIFE_SHARED long long scr_life_kind_lost = 0, scr_life_site_lost = 0;
SCR_LIFE_SHARED long long scr_life_pair_lost = 0, scr_life_ptr_lost = 0;
SCR_LIFE_SHARED long long scr_life_free_unknown = 0;

/* THE CLOCK. */
SCR_LIFE_SHARED long long scr_life_seq = 0;
SCR_LIFE_SHARED long long scr_life_bytes = 0;
SCR_LIFE_SHARED long long scr_life_ptr_live = 0, scr_life_ptr_peak = 0;
SCR_LIFE_SHARED long long scr_life_deaths = 0;
/* the global lifetime shape, for "is it even bimodal" */
SCR_LIFE_SHARED unsigned long long scr_life_ghist[SCR_LIFE_HB] = {0};
SCR_LIFE_SHARED long long scr_life_gl_sum = 0, scr_life_gl_sumsq = 0;

/* The site the running scr_cyc_alloc was called from.  Set at the top of
 * scr_cyc_alloc, read by both the carved arm and the miss, which is why it
 * is a global rather than an argument: the miss is noinline and
 * __builtin_return_address(0) there is scr_cyc_alloc itself. */
SCR_LIFE_SHARED const void *scr_life_ra = NULL;

/* the exit walk's accumulators */
SCR_LIFE_SHARED long long scr_life_wchunks = 0;
SCR_LIFE_SHARED long long scr_life_wlive = 0;     /* live slots the walk saw */
SCR_LIFE_SHARED long long scr_life_wjoined = 0;   /* ... found in the ptbl */
SCR_LIFE_SHARED long long scr_life_wmissed = 0;   /* ... NOT found: unexplained */
SCR_LIFE_SHARED long long scr_life_wbad = 0;      /* geometry the walk cannot read */
SCR_LIFE_SHARED long long scr_life_wbadused = 0;  /* carved-free != used */
SCR_LIFE_SHARED long long scr_life_wbytes = 0;    /* chunk bytes held */
SCR_LIFE_SHARED long long scr_life_wlivebytes = 0;
/* chunks by live count, so "dominated by chunks holding one" is a number */
SCR_LIFE_SHARED unsigned long long scr_life_cl_hist[17] = {0}; /* 0..15, 16=16+ */
SCR_LIFE_SHARED unsigned long long scr_life_cl_big = 0;
SCR_LIFE_SHARED long long scr_life_sole_chunks = 0;
SCR_LIFE_SHARED long long scr_life_le2_chunks = 0;
SCR_LIFE_SHARED int scr_life_reported = 0;
SCR_LIFE_SHARED FILE *scr_life_file = NULL;
SCR_LIFE_SHARED FILE *scr_life_blocks = NULL;
SCR_LIFE_SHARED int scr_life_want_blocks = -1;
/* set by scr_cycle.c just before the report: its own byte counter */
SCR_LIFE_SHARED unsigned long scr_life_arena_held = 0;

SCR_LIFE_FN unsigned scr_life_h(const void *p, unsigned mask) {
  unsigned long long x = (unsigned long long)(size_t)p;
  x ^= x >> 33;
  x *= 0xff51afd7ed558ccdULL;
  x ^= x >> 29;
  x *= 0xc4ceb9fe1a85ec53ULL;
  x ^= x >> 32;
  return (unsigned)(x & mask);
}

/* 256*log2(v+1) in fixed point, integer only.  The integer part is the index
 * of the top set bit; the fraction is linear interpolation inside the
 * binade, which is within 0.09 of true log2 and is identical on every run,
 * which is what matters for a variance comparison between two keys. */
SCR_LIFE_FN long long scr_life_lg(unsigned long long v) {
  unsigned long long x = v + 1ull;
  int e = 0;
  unsigned long long m;
  while (x >> (e + 1)) e++;
  if (e == 0) return 0;
  m = (x << (63 - e)) & 0x7fffffffffffffffull; /* fraction in [0,1) << 63 */
  return (long long)e * 256 + (long long)(m >> 55);
}

SCR_LIFE_FN unsigned scr_life_bucket(unsigned long long life) {
  unsigned b = 0;
  while (life >> (b + 1)) b++;
  if (b >= SCR_LIFE_HB) b = SCR_LIFE_HB - 1u;
  return b;
}

SCR_LIFE_FN unsigned scr_life_rowof(ScrLifeRow *tbl, unsigned slots,
                                    unsigned *order, long long *n,
                                    long long *lost, const void *key) {
  unsigned h = scr_life_h(key, slots - 1u);
  unsigned i;
  for (i = 0; i < slots; i++) {
    unsigned j = (h + i) & (slots - 1u);
    if (tbl[j].key == key) return j;
    if (tbl[j].key == NULL) {
      tbl[j].key = key;
      tbl[j].l_min = -1;
      order[(*n)++] = j;
      return j;
    }
  }
  (*lost)++;
  return SCR_LIFE_NOROW;
}

SCR_LIFE_FN unsigned scr_life_pairof(unsigned short k, unsigned short s) {
  unsigned long long x = ((unsigned long long)k << 20) ^ (unsigned long long)s;
  unsigned h = scr_life_h((const void *)(size_t)(x * 0x9e3779b97f4a7c15ull),
                          SCR_LIFE_PAIRSLOTS - 1u);
  unsigned i;
  for (i = 0; i < SCR_LIFE_PAIRSLOTS; i++) {
    unsigned j = (h + i) & (SCR_LIFE_PAIRSLOTS - 1u);
    if (scr_life_pair[j].used && scr_life_pair[j].kind == k &&
        scr_life_pair[j].site == s)
      return j;
    if (!scr_life_pair[j].used) {
      scr_life_pair[j].used = 1;
      scr_life_pair[j].kind = k;
      scr_life_pair[j].site = s;
      scr_life_porder[scr_life_npair++] = j;
      return j;
    }
  }
  scr_life_pair_lost++;
  return 0xffffffffu;
}

/* obj is the HEADER address; key the free_fn; ra the allocation site. */
SCR_LIFE_FN void scr_life_note_alloc(const void *obj, size_t phys,
                                     const void *key, const void *ra) {
  unsigned ki = scr_life_rowof(scr_life_kind, SCR_LIFE_KSLOTS, scr_life_korder,
                               &scr_life_nkind, &scr_life_kind_lost, key);
  unsigned si = ra == NULL
                    ? SCR_LIFE_NOROW
                    : scr_life_rowof(scr_life_site, SCR_LIFE_SSLOTS,
                                     scr_life_sorder, &scr_life_nsite,
                                     &scr_life_site_lost, ra);
  scr_life_seq++;
  scr_life_bytes += (long long)phys;
  if (ki < SCR_LIFE_KSLOTS) {
    scr_life_kind[ki].n_alloc++;
    scr_life_kind[ki].bytes_ever += (long long)phys;
  }
  if (si < SCR_LIFE_SSLOTS) {
    scr_life_site[si].n_alloc++;
    scr_life_site[si].bytes_ever += (long long)phys;
  }
  {
    unsigned pi = scr_life_pairof((unsigned short)ki, (unsigned short)si);
    if (pi != 0xffffffffu) scr_life_pair[pi].n_alloc++;
  }
  {
    unsigned mask = SCR_LIFE_PSLOTS - 1u;
    unsigned h = scr_life_h(obj, mask);
    unsigned i;
    for (i = 0; i < SCR_LIFE_PSLOTS; i++) {
      unsigned j = (h + i) & mask;
      if (scr_life_ptbl[j].p == NULL) {
        scr_life_ptbl[j].p = obj;
        scr_life_ptbl[j].birth = (unsigned)scr_life_seq;
        scr_life_ptbl[j].phys = (unsigned)phys;
        scr_life_ptbl[j].kind = (unsigned short)ki;
        scr_life_ptbl[j].site = (unsigned short)si;
        scr_life_ptr_live++;
        if (scr_life_ptr_live > scr_life_ptr_peak)
          scr_life_ptr_peak = scr_life_ptr_live;
        break;
      }
    }
    if (i == SCR_LIFE_PSLOTS) scr_life_ptr_lost++;
  }
}

SCR_LIFE_FN void scr_life_charge(ScrLifeRow *r, long long L,
                                 unsigned long long life) {
  r->n_dead++;
  r->l_sum += L;
  r->l_sumsq += L * L;
  if (r->l_min < 0 || L < r->l_min) r->l_min = L;
  if (L > r->l_max) r->l_max = L;
  r->hist[scr_life_bucket(life)]++;
}

SCR_LIFE_FN void scr_life_note_free(const void *obj) {
  unsigned mask = SCR_LIFE_PSLOTS - 1u;
  unsigned h = scr_life_h(obj, mask);
  unsigned hole = 0;
  int found = 0;
  unsigned ki = SCR_LIFE_NOROW, si = SCR_LIFE_NOROW;
  unsigned long long life = 0;
  long long L = 0;
  unsigned i;
  for (i = 0; i < SCR_LIFE_PSLOTS; i++) {
    unsigned j = (h + i) & mask;
    if (scr_life_ptbl[j].p == NULL) break;
    if (scr_life_ptbl[j].p == obj) {
      life = (unsigned long long)(scr_life_seq -
                                  (long long)scr_life_ptbl[j].birth);
      ki = scr_life_ptbl[j].kind;
      si = scr_life_ptbl[j].site;
      hole = j;
      found = 1;
      break;
    }
  }
  if (!found) {
    scr_life_free_unknown++;
    return;
  }
  L = scr_life_lg(life);
  scr_life_deaths++;
  scr_life_gl_sum += L;
  scr_life_gl_sumsq += L * L;
  scr_life_ghist[scr_life_bucket(life)]++;
  if (ki < SCR_LIFE_KSLOTS) scr_life_charge(&scr_life_kind[ki], L, life);
  if (si < SCR_LIFE_SSLOTS) scr_life_charge(&scr_life_site[si], L, life);
  {
    unsigned pi = scr_life_pairof((unsigned short)ki, (unsigned short)si);
    if (pi != 0xffffffffu) {
      scr_life_pair[pi].n_dead++;
      scr_life_pair[pi].l_sum += L;
      scr_life_pair[pi].l_sumsq += L * L;
    }
  }
  scr_life_ptr_live--;
  /* Backward-shift deletion, not tombstones: see cycensus's note. */
  scr_life_ptbl[hole].p = NULL;
  scr_life_ptbl[hole].birth = 0;
  scr_life_ptbl[hole].phys = 0;
  scr_life_ptbl[hole].kind = 0;
  scr_life_ptbl[hole].site = 0;
  for (unsigned k = (hole + 1u) & mask; scr_life_ptbl[k].p != NULL;
       k = (k + 1u) & mask) {
    unsigned ideal = scr_life_h(scr_life_ptbl[k].p, mask);
    int blocked =
        (hole <= k) ? (ideal > hole && ideal <= k) : (ideal > hole || ideal <= k);
    if (blocked) continue;
    scr_life_ptbl[hole] = scr_life_ptbl[k];
    scr_life_ptbl[k].p = NULL;
    scr_life_ptbl[k].birth = 0;
    scr_life_ptbl[k].phys = 0;
    scr_life_ptbl[k].kind = 0;
    scr_life_ptbl[k].site = 0;
    hole = k;
  }
}

/* ── THE CHUNK WALK ──────────────────────────────────────────────────────
 * Called once per chunk the arena still holds, from scr_cycle.c, with the
 * SAME arguments the page census is given in the same loop.  The live
 * bitmap is recomputed here rather than borrowed, so the reconciliation
 * against scr_pc_live_slots at report time is two independent walks of the
 * same chunks and not one walk reported twice. */
#define SCR_LIFE_MAXSLOTS 4096u

SCR_LIFE_FN void scr_life_reset_walk(void) {
  long long i;
  scr_life_wchunks = 0;
  scr_life_wlive = 0;
  scr_life_wjoined = 0;
  scr_life_wmissed = 0;
  scr_life_wbad = 0;
  scr_life_wbadused = 0;
  scr_life_wbytes = 0;
  scr_life_wlivebytes = 0;
  scr_life_cl_big = 0;
  scr_life_sole_chunks = 0;
  scr_life_le2_chunks = 0;
  for (i = 0; i < 17; i++) scr_life_cl_hist[i] = 0;
  for (i = 0; i < scr_life_nkind; i++) {
    ScrLifeRow *r = &scr_life_kind[scr_life_korder[i]];
    r->n_live = r->live_phys = r->live_l_sum = 0;
    r->n_pin = r->n_pin_sole = r->n_pin_le2 = r->pin_share_bytes = 0;
  }
  for (i = 0; i < scr_life_nsite; i++) {
    ScrLifeRow *r = &scr_life_site[scr_life_sorder[i]];
    r->n_live = r->live_phys = r->live_l_sum = 0;
    r->n_pin = r->n_pin_sole = r->n_pin_le2 = r->pin_share_bytes = 0;
  }
  for (i = 0; i < scr_life_npair; i++) {
    scr_life_pair[scr_life_porder[i]].n_live = 0;
    scr_life_pair[scr_life_porder[i]].n_pin = 0;
  }
}

SCR_LIFE_FN void scr_life_note_chunk(const void *basev, const void *limv,
                                     unsigned long hdrzone, unsigned long stride,
                                     const void *bumpv, unsigned long used,
                                     const void *freelistv, int role,
                                     unsigned gone, unsigned page) {
  static unsigned char live[SCR_LIFE_MAXSLOTS];
  const unsigned char *base = (const unsigned char *)basev;
  const unsigned char *bump = (const unsigned char *)bumpv;
  const unsigned char *cs = base + hdrzone;
  const void *b;
  unsigned long nslots, i, flen = 0, nlive, gone_slots = 0;
  (void)limv;

  scr_life_wchunks++;
  if (stride == 0 || bump < cs) {
    scr_life_wbad++;
    return;
  }
  nslots = (unsigned long)(bump - cs) / stride;
  if (nslots > SCR_LIFE_MAXSLOTS) {
    scr_life_wbad++;
    return;
  }
  memset(live, 1, (size_t)nslots);
  for (b = freelistv; b != NULL;) {
    const unsigned char *bp = (const unsigned char *)b;
    if (flen > nslots) {
      scr_life_wbad++;
      break;
    }
    flen++;
    if (bp >= cs && bp < bump && ((unsigned long)(bp - cs) % stride) == 0)
      live[(unsigned long)(bp - cs) / stride] = 0;
    memcpy(&b, bp, sizeof(void *));
  }
  /* Blocks on a RETURNED page are free and deliberately off the list; the
   * page census's note explains why.  The indexing must match the sweep's,
   * which is absolute from the first page-aligned address at or after cs. */
  if (gone != 0u) {
    uintptr_t fst = ((uintptr_t)(const void *)cs + (page - 1u)) &
                    ~(uintptr_t)(page - 1u);
    uintptr_t lst = (uintptr_t)(const void *)bump & ~(uintptr_t)(page - 1u);
    if (lst > fst) {
      unsigned npg = (unsigned)((lst - fst) / page);
      for (i = 0; i < nslots; i++) {
        uintptr_t a, z;
        unsigned k0, k1, k;
        if (!live[i]) continue;
        a = (uintptr_t)(const void *)(cs + i * stride);
        z = a + stride;
        if (z <= fst || a >= lst) continue;
        k0 = a <= fst ? 0u : (unsigned)((a - fst) / page);
        k1 = (unsigned)((z - 1u - fst) / page);
        if (k1 >= npg) k1 = npg - 1u;
        for (k = k0; k <= k1; k++)
          if ((gone >> k) & 1u) {
            live[i] = 0;
            gone_slots++;
            break;
          }
      }
    }
  }
  nlive = nslots >= flen + gone_slots ? nslots - flen - gone_slots : 0;
  if (nlive != used) scr_life_wbadused++;

  scr_life_wlive += (long long)nlive;
  scr_life_wbytes += 65536;
  scr_life_wlivebytes += (long long)nlive * stride;
  if (nlive < 16) scr_life_cl_hist[nlive]++;
  else {
    scr_life_cl_hist[16]++;
    scr_life_cl_big += nlive;
  }
  if (nlive == 1) scr_life_sole_chunks++;
  if (nlive >= 1 && nlive <= 2) scr_life_le2_chunks++;

  for (i = 0; i < nslots; i++) {
    const void *blk;
    unsigned mask = SCR_LIFE_PSLOTS - 1u;
    unsigned h, j, t;
    int got = 0;
    unsigned ki = SCR_LIFE_NOROW, si = SCR_LIFE_NOROW, birth = 0, phys = 0;
    if (!live[i]) continue;
    blk = (const void *)(cs + i * stride);
    h = scr_life_h(blk, mask);
    for (t = 0; t < SCR_LIFE_PSLOTS; t++) {
      j = (h + t) & mask;
      if (scr_life_ptbl[j].p == NULL) break;
      if (scr_life_ptbl[j].p == blk) {
        ki = scr_life_ptbl[j].kind;
        si = scr_life_ptbl[j].site;
        birth = scr_life_ptbl[j].birth;
        phys = scr_life_ptbl[j].phys;
        got = 1;
        break;
      }
    }
    if (!got) {
      scr_life_wmissed++;
      if (scr_life_blocks != NULL)
        fprintf(scr_life_blocks, "B %p %lu %lu %d UNJOINED\n", blk, stride,
                nlive, role);
      continue;
    }
    scr_life_wjoined++;
    {
      long long cens = scr_life_seq - (long long)birth;
      long long share = 65536 / (long long)(nlive ? nlive : 1);
      if (ki < SCR_LIFE_KSLOTS) {
        ScrLifeRow *r = &scr_life_kind[ki];
        r->n_live++;
        r->live_phys += (long long)phys;
        r->live_l_sum += scr_life_lg((unsigned long long)cens);
        r->n_pin++;
        if (nlive == 1) r->n_pin_sole++;
        if (nlive <= 2) r->n_pin_le2++;
        r->pin_share_bytes += share;
      }
      if (si < SCR_LIFE_SSLOTS) {
        ScrLifeRow *r = &scr_life_site[si];
        r->n_live++;
        r->live_phys += (long long)phys;
        r->live_l_sum += scr_life_lg((unsigned long long)cens);
        r->n_pin++;
        if (nlive == 1) r->n_pin_sole++;
        if (nlive <= 2) r->n_pin_le2++;
        r->pin_share_bytes += share;
      }
      {
        unsigned pi = scr_life_pairof((unsigned short)ki, (unsigned short)si);
        if (pi != 0xffffffffu) {
          scr_life_pair[pi].n_live++;
          scr_life_pair[pi].n_pin++;
        }
      }
      if (scr_life_blocks != NULL)
        fprintf(scr_life_blocks, "B %p %lu %lu %d %u %u %u %lld\n", blk, stride,
                nlive, role, ki, si, birth, cens);
    }
  }
}

/* ── THE REPORT ──────────────────────────────────────────────────────────*/
SCR_LIFE_FN void scr_life_row(FILE *f, const char *tag, ScrLifeRow *tbl,
                              unsigned *order, long long n, const void *anchor) {
  long long i;
  for (i = 0; i < n; i++) {
    ScrLifeRow *r = &tbl[order[i]];
    long long rva = (long long)((const char *)r->key - (const char *)anchor);
    unsigned b;
    fprintf(f,
            "%s %lld %lld %lld %lld %lld %lld %lld %lld %lld %lld %lld %lld "
            "%lld %lld %lld",
            tag, rva, r->n_alloc, r->n_dead, r->bytes_ever, r->l_sum, r->l_sumsq,
            r->l_min, r->l_max, r->n_live, r->live_phys, r->live_l_sum, r->n_pin,
            r->n_pin_sole, r->n_pin_le2, r->pin_share_bytes);
    for (b = 0; b < SCR_LIFE_HB; b++) fprintf(f, " %llu", r->hist[b]);
    fputc('\n', f);
  }
}

SCR_LIFE_FN void scr_life_report(const char *when) {
  FILE *f = scr_life_file != NULL ? scr_life_file : stderr;
  const void *anchor = (const void *)(size_t)&scr_collect_cycles;
  long long i;
  unsigned b;
  double tbytes = (double)sizeof(scr_life_kind) + (double)sizeof(scr_life_site) +
                  (double)sizeof(scr_life_pair) + (double)sizeof(scr_life_ptbl) +
                  (double)sizeof(scr_life_korder) + (double)sizeof(scr_life_sorder) +
                  (double)sizeof(scr_life_porder);

  fprintf(f, "[lifecen] ARMED when=%s anchor=%p\n", when, anchor);
  fprintf(f,
          "[lifecen] CLOCK seq=%lld bytes=%lld deaths=%lld live=%lld "
          "livepeak=%lld\n",
          scr_life_seq, scr_life_bytes, scr_life_deaths, scr_life_ptr_live,
          scr_life_ptr_peak);
  fprintf(f,
          "[lifecen] SELFTEST tableBytes=%.0f kinds=%lld sites=%lld pairs=%lld "
          "kindLost=%lld siteLost=%lld pairLost=%lld ptrLost=%lld "
          "freeUnknown=%lld\n",
          tbytes, scr_life_nkind, scr_life_nsite, scr_life_npair,
          scr_life_kind_lost, scr_life_site_lost, scr_life_pair_lost,
          scr_life_ptr_lost, scr_life_free_unknown);
  fprintf(f,
          "[lifecen] WALK chunks=%lld live=%lld joined=%lld missed=%lld "
          "bad=%lld badUsed=%lld chunkBytes=%lld liveBytes=%lld held=%lu\n",
          scr_life_wchunks, scr_life_wlive, scr_life_wjoined, scr_life_wmissed,
          scr_life_wbad, scr_life_wbadused, scr_life_wbytes,
          scr_life_wlivebytes, scr_life_arena_held);
  if (scr_life_wchunks == 0) fprintf(f, "[lifecen] NO CHUNKS\n");
  if (scr_life_deaths == 0) fprintf(f, "[lifecen] NO DEATHS\n");
  fprintf(f, "[lifecen] CHUNKLIVE");
  for (b = 0; b < 17; b++) fprintf(f, " %llu", scr_life_cl_hist[b]);
  fprintf(f, " big=%llu sole=%lld le2=%lld\n", scr_life_cl_big,
          scr_life_sole_chunks, scr_life_le2_chunks);
  fprintf(f, "[lifecen] GLOBAL lsum=%lld lsumsq=%lld n=%lld hist",
          scr_life_gl_sum, scr_life_gl_sumsq, scr_life_deaths);
  for (b = 0; b < SCR_LIFE_HB; b++) fprintf(f, " %llu", scr_life_ghist[b]);
  fputc('\n', f);
  scr_life_row(f, "K", scr_life_kind, scr_life_korder, scr_life_nkind, anchor);
  scr_life_row(f, "S", scr_life_site, scr_life_sorder, scr_life_nsite, anchor);
  for (i = 0; i < scr_life_npair; i++) {
    ScrLifePair *p = &scr_life_pair[scr_life_porder[i]];
    long long krva =
        p->kind < SCR_LIFE_KSLOTS
            ? (long long)((const char *)scr_life_kind[p->kind].key - (const char *)anchor)
            : 0;
    long long srva =
        p->site < SCR_LIFE_SSLOTS
            ? (long long)((const char *)scr_life_site[p->site].key - (const char *)anchor)
            : 0;
    fprintf(f, "P %lld %lld %lld %lld %lld %lld %lld %lld\n", krva, srva,
            p->n_alloc, p->n_dead, p->l_sum, p->l_sumsq, p->n_live, p->n_pin);
  }
  /* Every SURVIVOR, including those NOT in a held chunk (pooled, calloc'd,
   * or in a chunk the walk could not read): the complement of the pinner
   * population, which is what makes "a survivor is not a pinner" checkable
   * rather than asserted. */
  {
    long long surv = 0, survb = 0;
    unsigned j;
    for (j = 0; j < SCR_LIFE_PSLOTS; j++) {
      if (scr_life_ptbl[j].p == NULL) continue;
      surv++;
      survb += scr_life_ptbl[j].phys;
    }
    fprintf(f, "[lifecen] SURVIVORS n=%lld bytes=%lld inHeldChunks=%lld\n", surv,
            survb, scr_life_wjoined);
  }
  fflush(f);
}

SCR_LIFE_FN int scr_life_blocks_on(void) {
  if (scr_life_want_blocks < 0) {
    const char *e = getenv("SCR_LIFECEN_BLOCKS");
    scr_life_want_blocks = (e != NULL && strtol(e, NULL, 10) != 0) ? 1 : 0;
  }
  return scr_life_want_blocks;
}

SCR_LIFE_FN void scr_life_open(void) {
  const char *p = getenv("SCR_LIFECEN_OUT");
  if (scr_life_file != NULL) return;
  if (p != NULL && *p != '\0') scr_life_file = fopen(p, "w");
  if (scr_life_file == NULL) scr_life_file = stderr;
  if (scr_life_blocks_on() && p != NULL && *p != '\0') {
    char buf[1024];
    size_t n = strlen(p);
    if (n < sizeof buf - 8) {
      memcpy(buf, p, n);
      memcpy(buf + n, ".blocks", 8);
      scr_life_blocks = fopen(buf, "w");
    }
  }
}

/* scr_cycle.c sets this to its own walk; the exit routes call through it. */
SCR_LIFE_SHARED void (*scr_life_walk_fn)(const char *) = NULL;

SCR_LIFE_FN void scr_life_report_exit(void) {
  if (scr_life_reported) return;
  scr_life_reported = 1;
  scr_life_open();
  if (scr_life_walk_fn != NULL) scr_life_walk_fn("exit");
  else scr_life_report("exit-nowalk");
  if (scr_life_blocks != NULL) fflush(scr_life_blocks);
}

/* THE EXIT ROUTE IS BOTH, and the interposer is the one that fires: these PE
 * images run no .CRT teardown and process.exit lowers to _Exit, so an
 * atexit-only census compiles in and silently never runs.  This is
 * scr_page_census.h's arrangement, ported rather than redesigned. */
SCR_LIFE_SHARED int scr_life_atexit_done = 0;

__attribute__((constructor)) SCR_LIFE_FN void scr_life_install(void) {
  if (!scr_life_atexit_done) {
    scr_life_atexit_done = 1;
    atexit(scr_life_report_exit);
  }
}

/* COMPOSITION.  A macro cannot extend a macro it cannot name, so the chain
 * is spelled out, exactly as scr_page_census.h spells its own.  THIS HEADER
 * MUST BE -include'd LAST: read before the others it wins and theirs are
 * silently lost.  The check below is the mechanism, because a comment is
 * not one -- each of those headers sets its own include guard, so "armed
 * but not yet read" is the bad order and is detectable here. */
#if !defined(SCR_PAGE_CENSUS_H)
#error "scr_life_census.h must be -included AFTER tests/perf/pagecensus/scr_page_census.h"
#endif
#if defined(SCR_CYCSTAT_ON) && !defined(SCR_CYC_STAT_H)
#error "scr_life_census.h must be -included AFTER tests/perf/cycstat/scr_cyc_stat.h"
#endif
#if defined(SCR_CYCEN_ON) && !defined(SCR_CYC_CENSUS_H)
#error "scr_life_census.h must be -included AFTER tests/perf/cycensus/scr_cyc_census.h"
#endif

#ifdef _Exit
#undef _Exit
#endif
#if defined(SCR_PAGECEN_ON) && defined(SCR_CYCSTAT_ON) && defined(SCR_CYCEN_ON)
#define _Exit(c)                                                            (scr_life_report_exit(), scr_pc_report_exit(), scr_cs_report(),            scr_cycen_report(), _Exit(c))
#elif defined(SCR_PAGECEN_ON) && defined(SCR_CYCSTAT_ON)
#define _Exit(c)                                                            (scr_life_report_exit(), scr_pc_report_exit(), scr_cs_report(), _Exit(c))
#elif defined(SCR_PAGECEN_ON)
#define _Exit(c) (scr_life_report_exit(), scr_pc_report_exit(), _Exit(c))
#else
#define _Exit(c) (scr_life_report_exit(), _Exit(c))
#endif

#define SCR_LIFECEN_HAVE 1

#endif /* SCR_LIFECEN_ON */
#endif /* SCR_LIFE_CENSUS_H */
