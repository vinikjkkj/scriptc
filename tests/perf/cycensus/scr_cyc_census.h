/* scr_cyc_census.h — WHAT scr_cyc_alloc is allocating, and who still holds it.
 *
 * WHY THIS EXISTS. `tests/perf/prof/scr_prof.h`'s allocation lane keys every
 * row on a "file:line" site string. That is the right key everywhere except
 * at one line: `scr_cycle.c`'s `calloc`, which serves EVERY cycle-headered
 * object in a compiled program — roughly sixteen different kinds through one
 * call. estado-ramcpu measured 68.9% of zapo's live-heap peak arriving
 * through it and could say nothing about what any of it was, because the
 * only key available was the line number they share.
 *
 * The key this header uses instead is the `ScrCycFreeFn` that
 * `scr_cyc_alloc` is already handed. It identifies the object kind EXACTLY,
 * it costs nothing to obtain (it is an argument), and it needs no frame
 * walking, no `-fno-omit-frame-pointer` and no call-graph lane — the three
 * routes estado-ramcpu §5.4 named, two of which are blocked on this target.
 *
 * WHAT IT SEPARATES that a malloc-level lane cannot. `scr_cyc_free` does not
 * always call `free`: a block of 256 physical bytes or fewer goes onto
 * `scr_cyc_blocks`, the size-class pool in scr_runtime.h, and is reused. To
 * a lane that hooks malloc/free that block is indistinguishable from one the
 * program still holds — both are "allocated and never freed". This header
 * counts the two apart:
 *
 *     live   the program holds it: allocated, not yet scr_cyc_free'd
 *     pool   the program dropped it and the pool kept it (allocator slack)
 *     os     live + pool — what was calloc'd and never handed back, i.e.
 *            EXACTLY what scr_prof.h's live lane reports for scr_cycle.c
 *
 * so `os` is the number to compare against PROFLIVE for that line, and the
 * split of it into `live` and `pool` is the answer a malloc-level lane
 * cannot give.
 *
 * LINKAGE is scr_prof.h's, for scr_prof.h's reason: on x86_64-windows-gnu a
 * `weak` definition in every TU is 38 duplicate-symbol errors, not one
 * merged instance. Data is `selectany` (COMDAT, merged, ONE counter),
 * functions are `static` (per-TU code over that one shared state).
 *
 * NO <windows.h>. scr_prof.h needs it for GetModuleHandleW and paid for it
 * with `scr_fetch_dispatch.c`'s `fd_set` collision. This header reports raw
 * addresses plus the address of one anchor symbol (`scr_collect_cycles`)
 * and lets the reader do the subtraction, so it needs no platform header at
 * all and cannot re-open that hole.
 *
 * HOW TO USE IT
 *   SCRIPTC_PROF_CFLAGS="-include <repo>/tests/perf/cycensus/scr_cyc_census.h"
 *   SCR_CYCEN_OUT=<file>            where the report is written
 *   -DSCR_CYCEN_ARM=64              plant a known population; the reader
 *                                   refuses every number without it
 * The hooks themselves are two `#ifdef SCR_CYCEN_ON` lines in scr_cycle.c.
 * With this header not included the symbol is undefined and both vanish, so
 * an uninstrumented build is byte-identical — which is checked, not assumed.
 */
#ifndef SCR_CYC_CENSUS_H
#define SCR_CYC_CENSUS_H
#ifdef SCR_CYCEN_RAWSTR
/* LAB (holdraw): the string census header's _Exit chain names scr_prof_report, which only the profiler header defines; a weak no-op keeps the chain linkable */
void scr_prof_report(void);
__attribute__((weak)) void scr_prof_report(void) {}
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* The switch scr_cycle.c's two hook lines test. */
#define SCR_CYCEN_ON 1

#define SCR_CYCEN_SHARED __attribute__((selectany))
#define SCR_CYCEN_FN static __attribute__((unused)) __attribute__((no_instrument_function))

/* Kinds, not sites — and there are FAR more kinds than the runtime has.
 * estado-ramcpu says scr_cyc_alloc "serves roughly sixteen object kinds":
 * that is the RUNTIME's count, 17 call sites in packages/runtime/src. The
 * EMITTED program has its own. zapo's TU calls scr_cyc_alloc 1,434 times
 * with 1,434 DISTINCT free_fn values, one per cycle-graded shape
 * (`sc_gcfree__x25_m185_WaMessageClient` and 1,433 siblings), so the real
 * key space is ~1,452 and a 512-row table would have overflowed on the
 * first run. That is also why the emitted program's cycle objects have
 * never been counted as the emitted program's: a line-keyed lane charges
 * every one of them to scr_cycle.c.
 *
 * An overflow bumps scr_cycen_lost, which the report prints and the reader
 * refuses on, so it can never read as a zero. */
#ifndef SCR_CYCEN_SLOTS
#define SCR_CYCEN_SLOTS 8192u
#endif

/* A hard ceiling on SIMULTANEOUSLY LIVE cycle objects, not on the number
 * made. zapo holds ~78,000; 2^18 slots x 24 B = 6.3 MB of BSS, which is
 * zero pages until touched and is reported as tableBytes so nobody
 * subtracts it from the instrumented run's RSS and calls the remainder the
 * program's. */
#ifndef SCR_CYCEN_PSLOTS
#define SCR_CYCEN_PSLOTS (1u << 18)
#endif

/* The growth curve: one sample every N allocations. 88,000 allocations at
 * 500 is 176 samples. It answers "when in the run is the peak reached",
 * which for this workload is the whole question — 85% of peak RSS is
 * reached before the first stanza. */
/* the per-kind snapshot band; the peak itself is never banded. */
#ifndef SCR_CYCEN_SNAP_MIN
#define SCR_CYCEN_SNAP_MIN 4096
#endif

#ifndef SCR_CYCEN_CURVE_EVERY
#define SCR_CYCEN_CURVE_EVERY 500u
#endif
#ifndef SCR_CYCEN_CURVE_MAX
#define SCR_CYCEN_CURVE_MAX 4096u
#endif

typedef struct {
  const void *key; /* the ScrCycFreeFn: the object KIND. NULL = empty. */
  long long n_alloc, n_free, n_pool_hit, n_pool_give;
  long long bytes_ever;                        /* physical, header included */
  long long live_n, live_phys, live_payload;   /* held by the PROGRAM, now */
  long long snap_n, snap_phys, snap_payload;   /* the same, at the os peak */
  long long size_min, size_max, size_sum;      /* the REQUESTED payload size */
  long long park_n, park_phys, park_side;      /* of live_*, parked on a freelist */
  long long snap_park_n, snap_park_phys, snap_park_side;
} ScrCyCenRow;

typedef struct {
  const void *p; /* the HEADER address. NULL = empty; no tombstones. */
  unsigned row;
  unsigned phys;
  unsigned size;
  unsigned site; /* dyn nodes only: index into scr_cycen_sites (0 = none) */
} ScrCyCenPtr;

/* ALLOCATION SITES of dyn nodes. The census is -include'd before scr_runtime.h, so it cannot name ScrDyn; scr_json.c calls these. A site is the
 * first SCR_CYCEN_SITE_DEPTH return addresses up the frame-pointer chain from scr_dyn_alloc (build with -fno-omit-frame-pointer); the report
 * prints the raw addresses and the reader picks the first frame that is not a scr_* runtime function (the EMITTING function). */
#define SCR_CYCEN_CHUNKS 1
#define SCR_CYCEN_SITE_DEPTH 5 /* 6 frames made ~300k distinct chains on the redis bench, saturated the table and stalled every later dyn alloc (CI 43630870607) */
#ifndef SCR_CYCEN_SITES
#define SCR_CYCEN_SITES 262144u
#endif
SCR_CYCEN_SHARED unsigned long long scr_cycen_sites[SCR_CYCEN_SITES][SCR_CYCEN_SITE_DEPTH];
SCR_CYCEN_SHARED unsigned scr_cycen_nsites = 1; /* slot 0 = none */
SCR_CYCEN_SHARED unsigned scr_cycen_site_pending = 0;
SCR_CYCEN_SHARED long long scr_cycen_site_lost = 0;
SCR_CYCEN_SHARED ScrCyCenRow scr_cycen_tbl[SCR_CYCEN_SLOTS] = {{0}};
SCR_CYCEN_SHARED ScrCyCenPtr scr_cycen_ptbl[SCR_CYCEN_PSLOTS] = {{0}};
/* The occupied rows in insertion order, so a snapshot is O(kinds) and can
 * therefore be far cheaper than a walk of all SCR_CYCEN_SLOTS rows. It is
 * still banded (see the snapshot trigger): 1,452 occupied rows times
 * 78,000 growth steps is 113 million stores. */
SCR_CYCEN_SHARED unsigned scr_cycen_order[SCR_CYCEN_SLOTS] = {0};
SCR_CYCEN_SHARED long long scr_cycen_rows = 0;
SCR_CYCEN_SHARED long long scr_cycen_lost = 0;
SCR_CYCEN_SHARED long long scr_cycen_ptr_lost = 0;
SCR_CYCEN_SHARED long long scr_cycen_free_unknown = 0;

SCR_CYCEN_SHARED long long scr_cycen_live_n = 0, scr_cycen_live_phys = 0;
SCR_CYCEN_SHARED long long scr_cycen_live_payload = 0;
SCR_CYCEN_SHARED long long scr_cycen_pool_n = 0, scr_cycen_pool_phys = 0;
SCR_CYCEN_SHARED long long scr_cycen_os_peak = 0, scr_cycen_os_peak_n = 0;
SCR_CYCEN_SHARED long long scr_cycen_live_peak = 0, scr_cycen_pool_peak = 0;
SCR_CYCEN_SHARED long long scr_cycen_live_at_peak = 0, scr_cycen_pool_at_peak = 0;
SCR_CYCEN_SHARED long long scr_cycen_snaps = 0, scr_cycen_snap_ord = 0;
SCR_CYCEN_SHARED long long scr_cycen_snap_os = 0;
SCR_CYCEN_SHARED long long scr_cycen_alloc_total = 0, scr_cycen_free_total = 0;
SCR_CYCEN_SHARED long long scr_cycen_ptr_live = 0, scr_cycen_ptr_live_peak = 0;
SCR_CYCEN_SHARED long long scr_cycen_arm_phys = 0;
/* PARKED: a strict SUBSET of live. scr_json.c keeps up to
 * SCR_DYN_FREE_MAX dyn nodes on per-kind freelists rather than handing
 * them to scr_cyc_free, and a parked ARR/OBJ node keeps its items/entries
 * buffer too ("cap/entries preserved from the node's last life"). So a
 * third retention layer sits ABOVE the size-class pool, and to every lane
 * below it — including this one, without these three counters — a parked
 * node is indistinguishable from one the program still holds.
 *
 * live - parked is what the program actually holds. side is the bytes of
 * items/entries buffers riding along on parked nodes, which are NOT cycle
 * allocations and appear in scr_prof.h's rows for scr_json.c's realloc
 * lines instead. */
SCR_CYCEN_SHARED long long scr_cycen_park_n = 0, scr_cycen_park_phys = 0;
SCR_CYCEN_SHARED long long scr_cycen_park_side = 0, scr_cycen_park_peak = 0;
SCR_CYCEN_SHARED long long scr_cycen_park_at_peak = 0, scr_cycen_park_side_at_peak = 0;
SCR_CYCEN_SHARED long long scr_cycen_park_n_at_peak = 0;
SCR_CYCEN_SHARED long long scr_cycen_park_unknown = 0;
/* [ord, livePhys, poolPhys, liveN, poolN, secondsSinceFirstAlloc].
 * The clock is only in the CURVE samples, never on the allocation path
 * itself: a time() per allocation would be an instrument that changes
 * what it measures. One per SCR_CYCEN_CURVE_EVERY is 176 calls on zapo.
 * It answers the question estado-ramcpu left open - 85% of peak RSS is
 * reached before the first stanza, and this says whether the CYCLE heap
 * peaks there too. */
SCR_CYCEN_SHARED long long scr_cycen_curve[SCR_CYCEN_CURVE_MAX][6] = {{0}};
SCR_CYCEN_SHARED long long scr_cycen_t0 = 0;
SCR_CYCEN_SHARED long long scr_cycen_ncurve = 0;
SCR_CYCEN_SHARED int scr_cycen_reported = 0;
SCR_CYCEN_SHARED int scr_cycen_armed = 0;

/* The anchor. Declared rather than included: this header is -include'd
 * BEFORE scr_runtime.h, so the prototype has to be written out. It must
 * match, and it does — scr_runtime.h:414. */
void scr_collect_cycles(void);
/* scr_cycle.c's own live-object counter, for the cross-check in the report.
 * It is `static` there, so this is a value the report is HANDED rather than
 * one it reads; see scr_cycen_note_alloc's caller. */
SCR_CYCEN_SHARED long long scr_cycen_seen_live = 0;

SCR_CYCEN_FN unsigned scr_cycen_khash(const void *p) {
  unsigned long long x = (unsigned long long)(size_t)p;
  x ^= x >> 33;
  x *= 0xff51afd7ed558ccdULL;
  x ^= x >> 29;
  x *= 0xc4ceb9fe1a85ec53ULL;
  x ^= x >> 32;
  return (unsigned)(x & (SCR_CYCEN_SLOTS - 1u));
}

/* NOT scr_cycen_khash: that one folds into SCR_CYCEN_SLOTS because the ROW
 * table is that size. Reusing it here would confine 78,000 live pointers to
 * the first 512 slots of a 262,144-slot table and build one probe cluster —
 * the exact mistake estado-ramcpu §6.1 item 2 cost a block 137 seconds. */
SCR_CYCEN_FN unsigned scr_cycen_phash(const void *p) {
  unsigned long long x = (unsigned long long)(size_t)p;
  x ^= x >> 33;
  x *= 0xff51afd7ed558ccdULL;
  x ^= x >> 29;
  x *= 0xc4ceb9fe1a85ec53ULL;
  x ^= x >> 32;
  return (unsigned)(x & (SCR_CYCEN_PSLOTS - 1u));
}

__attribute__((noinline)) SCR_CYCEN_FN unsigned scr_cycen_site_capture(void) {
  unsigned long long r[SCR_CYCEN_SITE_DEPTH];
  int n = 0;
  void **fp = (void **)__builtin_frame_address(0);
  for (int i = 0; i < SCR_CYCEN_SITE_DEPTH; i++) r[i] = 0;
  while (n < SCR_CYCEN_SITE_DEPTH && fp != NULL && ((unsigned long long)(size_t)fp & 7u) == 0) {
    void **nfp = (void **)fp[0];
    r[n++] = (unsigned long long)(size_t)fp[1];
    if (nfp == NULL || nfp <= fp || (char *)nfp - (char *)fp > (1 << 20)) break;
    fp = nfp;
  }
  unsigned long long h = 1469598103934665603ULL;
  for (int i = 0; i < SCR_CYCEN_SITE_DEPTH; i++) { h ^= r[i]; h *= 1099511628211ULL; }
  unsigned mask = SCR_CYCEN_SITES - 1u, j = (unsigned)(h >> 20) & mask;
  for (unsigned t = 0; t < 32u; t++, j = (j + 1u) & mask) { /* bounded probe: a full table must cost O(1) per allocation, not O(table) */
    if (j == 0) continue;
    if (scr_cycen_sites[j][0] == 0) {
      for (int i = 0; i < SCR_CYCEN_SITE_DEPTH; i++) scr_cycen_sites[j][i] = r[i];
      scr_cycen_nsites++;
      return j;
    }
    int same = 1;
    for (int i = 0; i < SCR_CYCEN_SITE_DEPTH; i++) if (scr_cycen_sites[j][i] != r[i]) { same = 0; break; }
    if (same) return j;
  }
  scr_cycen_site_lost++;
  return 0;
}
SCR_CYCEN_FN void scr_cycen_resite(const void *hdr) {
  unsigned site = scr_cycen_site_capture();
  unsigned mask = SCR_CYCEN_PSLOTS - 1u, h = scr_cycen_phash(hdr);
  for (unsigned i = 0; i < SCR_CYCEN_PSLOTS; i++) {
    unsigned j = (h + i) & mask;
    if (scr_cycen_ptbl[j].p == NULL) return;
    if (scr_cycen_ptbl[j].p == hdr) { scr_cycen_ptbl[j].site = site; return; }
  }
}

SCR_CYCEN_FN unsigned scr_cycen_row_of(const void *key) {
  unsigned h = scr_cycen_khash(key);
  for (unsigned i = 0; i < SCR_CYCEN_SLOTS; i++) {
    unsigned j = (h + i) & (SCR_CYCEN_SLOTS - 1u);
    if (scr_cycen_tbl[j].key == key) return j;
    if (scr_cycen_tbl[j].key == NULL) {
      scr_cycen_tbl[j].key = key;
      scr_cycen_tbl[j].size_min = -1;
      scr_cycen_order[scr_cycen_rows++] = j;
      return j;
    }
  }
  scr_cycen_lost++;
  return SCR_CYCEN_SLOTS; /* the sentinel: "no row" */
}

SCR_CYCEN_FN void scr_cycen_snapshot(void) {
  scr_cycen_snaps++;
  scr_cycen_snap_ord = scr_cycen_alloc_total;
  scr_cycen_snap_os = scr_cycen_live_phys + scr_cycen_pool_phys;
  scr_cycen_live_at_peak = scr_cycen_live_phys;
  scr_cycen_pool_at_peak = scr_cycen_pool_phys;
  scr_cycen_park_at_peak = scr_cycen_park_phys;
  scr_cycen_park_n_at_peak = scr_cycen_park_n;
  scr_cycen_park_side_at_peak = scr_cycen_park_side;
  for (long long i = 0; i < scr_cycen_rows; i++) {
    ScrCyCenRow *r = &scr_cycen_tbl[scr_cycen_order[i]];
    r->snap_n = r->live_n;
    r->snap_phys = r->live_phys;
    r->snap_payload = r->live_payload;
    r->snap_park_n = r->park_n;
    r->snap_park_phys = r->park_phys;
    r->snap_park_side = r->park_side;
  }
}

/* obj is the HEADER address (the block), phys its physical size, size the
 * payload scr_cyc_alloc was asked for, key the free_fn, pooled 1 when the
 * block came off the size-class pool rather than from calloc. */
SCR_CYCEN_FN void scr_cycen_note_alloc(const void *obj, size_t phys, size_t size,
                                       const void *key, int pooled, size_t cyc_live) {
  unsigned ri = scr_cycen_row_of(key);
  scr_cycen_alloc_total++;
  scr_cycen_seen_live = (long long)cyc_live;
  if (pooled) {
    scr_cycen_pool_n--;
    scr_cycen_pool_phys -= (long long)phys;
  }
  scr_cycen_live_n++;
  scr_cycen_live_phys += (long long)phys;
  scr_cycen_live_payload += (long long)size;
  if (ri < SCR_CYCEN_SLOTS) {
    ScrCyCenRow *r = &scr_cycen_tbl[ri];
    r->n_alloc++;
    r->bytes_ever += (long long)phys;
    if (pooled) r->n_pool_hit++;
    r->live_n++;
    r->live_phys += (long long)phys;
    r->live_payload += (long long)size;
    r->size_sum += (long long)size;
    if (r->size_min < 0 || (long long)size < r->size_min) r->size_min = (long long)size;
    if ((long long)size > r->size_max) r->size_max = (long long)size;
  }
  /* the pointer table: exact per-object accounting, so a free can be
   * charged back to the row that ALLOCATED it and to the right bytes. */
  {
    unsigned h = scr_cycen_phash(obj);
    unsigned i;
    for (i = 0; i < SCR_CYCEN_PSLOTS; i++) {
      unsigned j = (h + i) & (SCR_CYCEN_PSLOTS - 1u);
      if (scr_cycen_ptbl[j].p == NULL) {
        scr_cycen_ptbl[j].p = obj;
        scr_cycen_ptbl[j].row = ri;
        scr_cycen_ptbl[j].phys = (unsigned)phys;
        scr_cycen_ptbl[j].size = (unsigned)size;
        scr_cycen_ptbl[j].site = scr_cycen_site_pending != 0 ? scr_cycen_site_pending : scr_cycen_site_capture(); /* every cyc object gets its allocation site, not only dyn nodes */
        scr_cycen_site_pending = 0;
        scr_cycen_ptr_live++;
        if (scr_cycen_ptr_live > scr_cycen_ptr_live_peak)
          scr_cycen_ptr_live_peak = scr_cycen_ptr_live;
        break;
      }
    }
    if (i == SCR_CYCEN_PSLOTS) scr_cycen_ptr_lost++;
  }
  if (scr_cycen_live_phys > scr_cycen_live_peak) scr_cycen_live_peak = scr_cycen_live_phys;
  {
    /* The PEAK itself is exact and unconditional. Only the per-kind
     * breakdown is sampled, because a snapshot walks every occupied row
     * and there are ~1,452 of them: taken on all 78,000 growth steps that
     * is 113 million stores, an instrument slow enough to change the
     * protocol timings it runs under. It is taken when the peak has grown
     * past the last snapshot by more than SCR_CYCEN_SNAP_MIN or a
     * thousandth, whichever is larger, so the breakdown is within that
     * band of the true peak and the band is printed. */
    long long os = scr_cycen_live_phys + scr_cycen_pool_phys;
    if (os > scr_cycen_os_peak) {
      scr_cycen_os_peak = os;
      scr_cycen_os_peak_n = scr_cycen_live_n + scr_cycen_pool_n;
      long long band = scr_cycen_snap_os / 1024;
      if (band < SCR_CYCEN_SNAP_MIN) band = SCR_CYCEN_SNAP_MIN;
      if (os > scr_cycen_snap_os + band) scr_cycen_snapshot();
    }
  }
  if (scr_cycen_alloc_total % SCR_CYCEN_CURVE_EVERY == 0 &&
      scr_cycen_ncurve < (long long)SCR_CYCEN_CURVE_MAX) {
    long long *s = scr_cycen_curve[scr_cycen_ncurve++];
    s[0] = scr_cycen_alloc_total;
    s[1] = scr_cycen_live_phys;
    s[2] = scr_cycen_pool_phys;
    s[3] = scr_cycen_live_n;
    s[4] = scr_cycen_pool_n;
    {
      long long now = (long long)time(NULL);
      if (scr_cycen_t0 == 0) scr_cycen_t0 = now;
      s[5] = now - scr_cycen_t0;
    }
  }
}

/* pooled 1 when scr_pool_give took the block (no free() ran). */
SCR_CYCEN_FN void scr_cycen_note_free(const void *obj, int pooled, size_t cyc_live) {
  unsigned mask = SCR_CYCEN_PSLOTS - 1u;
  unsigned h = scr_cycen_phash(obj);
  unsigned hole = 0;
  int found = 0;
  scr_cycen_seen_live = (long long)cyc_live;
  for (unsigned i = 0; i < SCR_CYCEN_PSLOTS; i++) {
    unsigned j = (h + i) & mask;
    if (scr_cycen_ptbl[j].p == NULL) break;
    if (scr_cycen_ptbl[j].p == obj) {
      unsigned ri = scr_cycen_ptbl[j].row;
      long long phys = (long long)scr_cycen_ptbl[j].phys;
      long long size = (long long)scr_cycen_ptbl[j].size;
      scr_cycen_free_total++;
      scr_cycen_live_n--;
      scr_cycen_live_phys -= phys;
      scr_cycen_live_payload -= size;
      if (pooled) {
        scr_cycen_pool_n++;
        scr_cycen_pool_phys += phys;
        if (scr_cycen_pool_phys > scr_cycen_pool_peak)
          scr_cycen_pool_peak = scr_cycen_pool_phys;
      }
      if (ri < SCR_CYCEN_SLOTS) {
        ScrCyCenRow *r = &scr_cycen_tbl[ri];
        r->n_free++;
        if (pooled) r->n_pool_give++;
        r->live_n--;
        r->live_phys -= phys;
        r->live_payload -= size;
      }
      scr_cycen_ptr_live--;
      hole = j;
      found = 1;
      break;
    }
  }
  if (!found) {
    scr_cycen_free_unknown++;
    return;
  }
  /* Backward-shift deletion, not tombstones: a workload that frees most of
   * what it allocates turns every touched slot into a non-empty one, and a
   * linear probe that stops only at an EMPTY slot then walks without bound.
   * An element may move into the hole only if its ideal slot is NOT
   * cyclically inside (hole, k]. */
  scr_cycen_ptbl[hole].p = NULL;
  scr_cycen_ptbl[hole].row = 0;
  scr_cycen_ptbl[hole].phys = 0;
  scr_cycen_ptbl[hole].size = 0;
  scr_cycen_ptbl[hole].site = 0;
  for (unsigned k = (hole + 1u) & mask; scr_cycen_ptbl[k].p != NULL; k = (k + 1u) & mask) {
    unsigned ideal = scr_cycen_phash(scr_cycen_ptbl[k].p);
    int blocked = (hole <= k) ? (ideal > hole && ideal <= k) : (ideal > hole || ideal <= k);
    if (blocked) continue;
    scr_cycen_ptbl[hole] = scr_cycen_ptbl[k];
    scr_cycen_ptbl[k].p = NULL;
    scr_cycen_ptbl[k].row = 0;
    scr_cycen_ptbl[k].phys = 0;
    scr_cycen_ptbl[k].size = 0;
    scr_cycen_ptbl[k].site = 0;
    hole = k;
  }
}

/* sizeof(ScrCycHdr) as this build actually has it. scr_cycle.c's hook is
 * the only place that knows it, so it is STORED rather than assumed: the
 * per-object overhead this census exists to quantify must not come from a
 * constant in the reader. 32 in a default build; the reader checks it
 * against live_phys - live_payload and refuses a mismatch. */
SCR_CYCEN_SHARED long long scr_cycen_hdr_bytes = 0;

/* PARK / UNPARK: the third retention layer, above the pool.
 *
 * scr_json.c's scr_dyn_gcfree does not always reach scr_cyc_free — up to
 * SCR_DYN_FREE_MAX dyn nodes go onto per-kind freelists instead, and an
 * ARR/OBJ node parked there keeps its items/entries buffer for its next
 * life. Nothing below this point can tell such a node from one the program
 * still holds: it was never freed at any level. `side` is those retained
 * items/entries bytes, which are NOT cycle allocations and would otherwise
 * be invisible here entirely.
 *
 * Parked is a strict SUBSET of live, so live - parked is what the program
 * actually holds. A park of an object the census never saw allocated bumps
 * park_unknown, which the report prints. */
SCR_CYCEN_FN void scr_cycen_park_delta(const void *obj, long long side, int dir) {
  unsigned h = scr_cycen_phash(obj);
  for (unsigned i = 0; i < SCR_CYCEN_PSLOTS; i++) {
    unsigned j = (h + i) & (SCR_CYCEN_PSLOTS - 1u);
    if (scr_cycen_ptbl[j].p == NULL) break;
    if (scr_cycen_ptbl[j].p == obj) {
      long long phys = (long long)scr_cycen_ptbl[j].phys;
      unsigned ri = scr_cycen_ptbl[j].row;
      scr_cycen_park_n += dir;
      scr_cycen_park_phys += dir * phys;
      scr_cycen_park_side += dir * side;
      if (scr_cycen_park_phys + scr_cycen_park_side > scr_cycen_park_peak)
        scr_cycen_park_peak = scr_cycen_park_phys + scr_cycen_park_side;
      if (ri < SCR_CYCEN_SLOTS) {
        ScrCyCenRow *r = &scr_cycen_tbl[ri];
        r->park_n += dir;
        r->park_phys += dir * phys;
        r->park_side += dir * side;
      }
      return;
    }
  }
  scr_cycen_park_unknown++;
}
SCR_CYCEN_FN void scr_cycen_note_park(const void *obj, long long side) {
  scr_cycen_park_delta(obj, side, 1);
}
SCR_CYCEN_FN void scr_cycen_note_unpark(const void *obj, long long side) {
  scr_cycen_park_delta(obj, side, -1);
}


/* ── SEAM PROBE: live objects per kind before vs after a FORCED collection ──
 * scr_cycen_seam() is called from scr_collect_cycles_idle (the between-turns
 * seam). When the live bytes have grown >= SCR_CYCEN_PROBE_STEP percent past the last probe (and are
 * above SCR_CYCEN_PROBE_MIN), it copies every row's live_n/live_phys ("before"), runs scr_collect_cycles() regardless of
 * pace, and copies them again ("after"). The probe with the largest "before" is kept whole and written by the report
 * (CYCEN-PROBE-ROW). Every probe is also summarised (CYCEN-PROBE). A forced collection moves timing after the seam: RSS
 * figures must come from an uninstrumented run. */
#ifndef SCR_CYCEN_PROBE_STEP
#define SCR_CYCEN_PROBE_STEP 2
#endif
#ifndef SCR_CYCEN_PROBE_MIN
#define SCR_CYCEN_PROBE_MIN (1 << 20)
#endif
#ifndef SCR_CYCEN_PROBE_MAX
#define SCR_CYCEN_PROBE_MAX 1024
#endif
SCR_CYCEN_SHARED long long scr_cycen_pr_last = 0, scr_cycen_pr_n = 0;
SCR_CYCEN_SHARED long long scr_cycen_pr_sum[SCR_CYCEN_PROBE_MAX][6];
SCR_CYCEN_SHARED long long scr_cycen_pr_best = -1, scr_cycen_pr_best_before = -1;
SCR_CYCEN_SHARED long long scr_cycen_pr_rows = 0;
SCR_CYCEN_SHARED long long scr_cycen_pr_bn[SCR_CYCEN_SLOTS], scr_cycen_pr_bp[SCR_CYCEN_SLOTS];
SCR_CYCEN_SHARED long long scr_cycen_pr_an[SCR_CYCEN_SLOTS], scr_cycen_pr_ap[SCR_CYCEN_SLOTS];
SCR_CYCEN_SHARED long long scr_cycen_pr_hn[SCR_CYCEN_SLOTS], scr_cycen_pr_hp[SCR_CYCEN_SLOTS];
SCR_CYCEN_SHARED long long scr_cycen_pr_hanc[SCR_CYCEN_SLOTS], scr_cycen_pr_hsave_rows = 0;
SCR_CYCEN_SHARED int scr_cycen_pr_busy = 0;

/* ── exact arena counters + dyn-node allocation sites, at the probe instant ── */
#define SCR_CYCEN_NCLASS 40
long long scr_cycen_arena_walk(long long (*out)[13], int nclass);
const void *scr_cycen_dyn_key(void);
int scr_cycen_dyn_peek(const void *hdr, unsigned *len);
int scr_cycen_dyn_peek2(const void *hdr, unsigned *len, unsigned *cap, unsigned long long *ext);
int scr_cycen_dyn_side(const void *hdr, const void **buf, unsigned long long *bytes);
int scr_cycen_arr_side(const void *key, const void *hdr, const void **buf, unsigned long long *bytes);
int scr_cycen_map_side(const void *key, const void *hdr, const void **buf, unsigned long long *bytes);
int scr_cycen_dyn_peek3(const void *hdr, unsigned *eks, char *key, unsigned long long *rc, unsigned long long *e0src);
/* ALL cyc objects by (allocation site, kind): count, physical bytes (header included), and the side-buffer bytes of dyn ARR/OBJ nodes */
#define SCR_CYCEN_AKSLOTS 131072u
typedef struct { unsigned long long key; const void *kind; long long n, phys, ext; } ScrCyCenAK; /* key = site<<13 | row, +1 */
SCR_CYCEN_SHARED ScrCyCenAK scr_cycen_ak[SCR_CYCEN_AKSLOTS], scr_cycen_ak_best[SCR_CYCEN_AKSLOTS];
SCR_CYCEN_SHARED long long scr_cycen_ak_phys = 0, scr_cycen_ak_phys_best = 0;
long long scr_cycen_dyn_free_count(void);
int scr_cycen_dyn_peek_str(const void *hdr, unsigned *len, unsigned *cap, int *imm, unsigned long long *rc, unsigned long long *hash, const char **data);
/* per-site STR node census: key = site, +1; n nodes, nimm nodes whose string is an immortal literal, sumlen/sumphys of the NON-immortal strings, nshared those with rc > 1, ndistinct distinct contents */
#define SCR_CYCEN_STRSLOTS 8192u
typedef struct { unsigned key; long long n, nimm, sumlen, sumphys, nshared, ndistinct; } ScrCyCenStr;
SCR_CYCEN_SHARED ScrCyCenStr scr_cycen_str[SCR_CYCEN_STRSLOTS], scr_cycen_str_best[SCR_CYCEN_STRSLOTS];
/* per site: node count by exact string length (64 = 64 or more) and the first SCR_CYCEN_NSAMP distinct heap contents (length + the first 47 bytes) */
#define SCR_CYCEN_NSAMP 24
typedef struct { unsigned lenhist[65]; unsigned nsamp; struct { unsigned len; char txt[48]; } samp[SCR_CYCEN_NSAMP]; } ScrCyCenStrX;
SCR_CYCEN_SHARED ScrCyCenStrX scr_cycen_strx[SCR_CYCEN_STRSLOTS], scr_cycen_strx_best[SCR_CYCEN_STRSLOTS];
#define SCR_CYCEN_DSET (1u << 21)
SCR_CYCEN_SHARED unsigned long long scr_cycen_dset[SCR_CYCEN_DSET];
SCR_CYCEN_SHARED long long scr_cycen_str_total = 0, scr_cycen_str_total_best = 0, scr_cycen_str_distinct = 0, scr_cycen_str_distinct_best = 0;
SCR_CYCEN_SHARED long long scr_cycen_ar_cur[SCR_CYCEN_NCLASS][13], scr_cycen_ar_best[SCR_CYCEN_NCLASS][13];
SCR_CYCEN_SHARED long long scr_cycen_ar_held_cur = 0, scr_cycen_ar_held_best = 0;
/* census-side counters at the same instant, for the cross-check against the arena's own `used` sum (blocks <= 256 B are the arena's) */
SCR_CYCEN_SHARED long long scr_cycen_x_small_n = 0, scr_cycen_x_small_phys = 0, scr_cycen_x_big_n = 0, scr_cycen_x_big_phys = 0;
SCR_CYCEN_SHARED long long scr_cycen_x_best[4], scr_cycen_x_park_best[3], scr_cycen_x_dynfree_best = 0;
/* dyn aggregates: (site,kind) -> n,bytes ; (kind,len bucket) -> n,bytes */
#define SCR_CYCEN_SKSLOTS 32768u
typedef struct { unsigned key; long long n, bytes; } ScrCyCenSK; /* key = site<<5 | kind, +1 so 0 = empty */
SCR_CYCEN_SHARED ScrCyCenSK scr_cycen_sk[SCR_CYCEN_SKSLOTS], scr_cycen_sk_best[SCR_CYCEN_SKSLOTS];
#define SCR_CYCEN_LB 48
SCR_CYCEN_SHARED long long scr_cycen_shape[32][SCR_CYCEN_LB][2], scr_cycen_shape_best[32][SCR_CYCEN_LB][2];
SCR_CYCEN_SHARED long long scr_cycen_dyn_total_n = 0, scr_cycen_dyn_total_b = 0, scr_cycen_dyn_total_best_n = 0, scr_cycen_dyn_total_best_b = 0;

SCR_CYCEN_FN int scr_cycen_lbucket(unsigned len) {
  if (len < 16) return (int)len;
  int b = 0; unsigned v = len;
  while (v > 1) { v >>= 1; b++; }
  return 16 + (b - 4) * 2 + ((len >> (b - 1)) & 1u); /* two rows per power of two from 16 */
}

SCR_CYCEN_FN void scr_cycen_sk_add(unsigned site, int kind, long long bytes) {
  unsigned key = ((site << 5) | (unsigned)(kind & 31)) + 1u, mask = SCR_CYCEN_SKSLOTS - 1u, j = (key * 2654435761u >> 7) & mask;
  for (unsigned t = 0; t < SCR_CYCEN_SKSLOTS; t++, j = (j + 1u) & mask) {
    if (scr_cycen_sk[j].key == 0) scr_cycen_sk[j].key = key;
    if (scr_cycen_sk[j].key == key) { scr_cycen_sk[j].n++; scr_cycen_sk[j].bytes += bytes; return; }
  }
}

/* LAB: per-site SHAPE table. One row per (site, kind, len, cap, first-item kinds): count, side bytes, summed node rc, strings behind a first-item STR that are shared, sample keys. */
#define SCR_CYCEN_SHSLOTS 65536u
typedef struct { unsigned long long key; unsigned site, kind, len, cap, eks; long long n, ext, rcsum, e0shared; char keys[24]; } ScrCyCenSh;
SCR_CYCEN_SHARED ScrCyCenSh scr_cycen_sh[SCR_CYCEN_SHSLOTS], scr_cycen_sh_best[SCR_CYCEN_SHSLOTS];
SCR_CYCEN_FN void scr_cycen_sh_add(unsigned site, int kind, unsigned len, unsigned cap, unsigned eks, unsigned long long ext, unsigned long long rc, unsigned long long e0src, const char *keys) {
  unsigned long long key = (((unsigned long long)site * 1000003ULL + (unsigned)kind) * 1000003ULL + len) * 1000003ULL + cap;
  key = (key * 1000003ULL + eks) | 1ULL;
  unsigned mask = SCR_CYCEN_SHSLOTS - 1u, j = (unsigned)((key * 0x9E3779B97F4A7C15ULL) >> 40) & mask;
  for (unsigned t = 0; t < SCR_CYCEN_SHSLOTS; t++, j = (j + 1u) & mask) {
    if (scr_cycen_sh[j].key == 0) { scr_cycen_sh[j].n = scr_cycen_sh[j].ext = scr_cycen_sh[j].rcsum = scr_cycen_sh[j].e0shared = 0; scr_cycen_sh[j].key = key; scr_cycen_sh[j].site = site; scr_cycen_sh[j].kind = (unsigned)kind; scr_cycen_sh[j].len = len; scr_cycen_sh[j].cap = cap; scr_cycen_sh[j].eks = eks; for (int q = 0; q < 23; q++) scr_cycen_sh[j].keys[q] = keys[q]; scr_cycen_sh[j].keys[23] = 0; }
    if (scr_cycen_sh[j].key != key) continue;
    scr_cycen_sh[j].n++; scr_cycen_sh[j].ext += (long long)ext; scr_cycen_sh[j].rcsum += (long long)(rc == (unsigned long long)-1 ? 0 : rc); if (e0src > 1) scr_cycen_sh[j].e0shared++;
    return;
  }
}

/* LAB: WHO HOLDS EACH dyn ARR. A conservative word scan: the set of every live ARR node, then every word of every live cyc object's payload and of every
 * dyn ARR/OBJ side buffer, tag bits stripped, looked up in it. A hit is a holder (target site, holder kind = its free function, holder site, via
 * payload or side buffer). A target's refcount minus the holders found is the count a heap object does not explain (a stack temp, a global, a
 * pending-exception cell, a promise reaction list or a hash entry). */
#ifndef SCR_CYCEN_HSET
#define SCR_CYCEN_HSET (1u << 21)
#endif /* 2M targets: the sqlite send_group peak holds ~543k dyn STR nodes */
#ifndef SCR_CYCEN_HOLD_CHAIN
#define SCR_CYCEN_HOLD_CHAIN 0
#endif
#ifndef SCR_CYCEN_HOLD_KIND
#define SCR_CYCEN_HOLD_KIND 4 /* the dyn kind whose nodes are the targets: 4 = ARR (the original scan), 3 = STR */
#endif
#ifndef SCR_CYCEN_RSTRIDE
#define SCR_CYCEN_RSTRIDE 300u /* LAB (holdraw): sample every Nth live heap string */
#endif
#ifndef SCR_CYCEN_RMINLEN
#define SCR_CYCEN_RMINLEN 8u /* ... of at least this length */
#endif
#define SCR_CYCEN_NSN 200u
#define SCR_CYCEN_SNSTRIDE 2500u
#define SCR_CYCEN_HOLDSLOTS 16384u
typedef struct { unsigned tsite; const void *hkind; unsigned hsite; unsigned via; long long n; } ScrCyCenHold;
typedef struct { unsigned tsite; long long ntargets, rcsum, found, unexplained, norefs; } ScrCyCenHoldT;
SCR_CYCEN_SHARED unsigned long long scr_cycen_hs_key[SCR_CYCEN_HSET];
SCR_CYCEN_SHARED unsigned scr_cycen_hs_site[SCR_CYCEN_HSET], scr_cycen_hs_found[SCR_CYCEN_HSET];
SCR_CYCEN_SHARED unsigned long long scr_cycen_hs_rc[SCR_CYCEN_HSET];
/* the FIRST holder found for each target, for the payload samples */
SCR_CYCEN_SHARED const void *scr_cycen_hs_hk[SCR_CYCEN_HSET];
SCR_CYCEN_SHARED unsigned scr_cycen_hs_hsite[SCR_CYCEN_HSET], scr_cycen_hs_via[SCR_CYCEN_HSET];
/* CHAIN mode (-DSCR_CYCEN_HOLD_CHAIN=1): every live cyc object is in the set, with its own kind (free function) and the ADDRESS of its first holder, so a sampled STR node can be followed up through its holders to a non-dyn object */
SCR_CYCEN_SHARED const void *scr_cycen_hs_selfk[SCR_CYCEN_HSET], *scr_cycen_hs_hp[SCR_CYCEN_HSET];
/* ~200 sampled targets (every SCR_CYCEN_SNSTRIDE-th STR target): the node's site and reference count, the string's reference count and length, its first 40 bytes, and the first holder */
#define SCR_CYCEN_CHAINMAX 12
typedef struct { unsigned tsite, len, via, hsite, slot, found, nchain; unsigned long long noderc, strrc; const void *hkind; char txt[41]; const void *chk[SCR_CYCEN_CHAINMAX]; unsigned chs[SCR_CYCEN_CHAINMAX]; } ScrCyCenSN;
SCR_CYCEN_SHARED ScrCyCenSN scr_cycen_sn[SCR_CYCEN_NSN], scr_cycen_sn_best[SCR_CYCEN_NSN];
SCR_CYCEN_SHARED unsigned scr_cycen_nsn, scr_cycen_nsn_best;
SCR_CYCEN_SHARED ScrCyCenHold scr_cycen_hold[SCR_CYCEN_HOLDSLOTS], scr_cycen_hold_best[SCR_CYCEN_HOLDSLOTS];
SCR_CYCEN_SHARED ScrCyCenHoldT scr_cycen_holdt[SCR_CYCEN_HOLDSLOTS], scr_cycen_holdt_best[SCR_CYCEN_HOLDSLOTS];
SCR_CYCEN_FN unsigned scr_cycen_hs_find(unsigned long long k, int insert) {
  unsigned m = SCR_CYCEN_HSET - 1u, j = (unsigned)((k * 0x9E3779B97F4A7C15ULL) >> 40) & m;
  for (unsigned t = 0; t < SCR_CYCEN_HSET; t++, j = (j + 1u) & m) {
    if (scr_cycen_hs_key[j] == k) return j;
    if (scr_cycen_hs_key[j] == 0) { if (insert) { scr_cycen_hs_key[j] = k; return j; } return (unsigned)-1; }
  }
  return (unsigned)-1;
}
SCR_CYCEN_FN void scr_cycen_hold_add(unsigned tsite, const void *hkind, unsigned hsite, unsigned via) {
  unsigned long long k = (((unsigned long long)tsite * 1000003ULL + (unsigned long long)(size_t)hkind) * 1000003ULL + hsite) * 3ULL + via + 1ULL;
  unsigned m = SCR_CYCEN_HOLDSLOTS - 1u, j = (unsigned)((k * 0x9E3779B97F4A7C15ULL) >> 40) & m;
  for (unsigned t = 0; t < SCR_CYCEN_HOLDSLOTS; t++, j = (j + 1u) & m) {
    ScrCyCenHold *h = &scr_cycen_hold[j];
    if (h->n == 0) { h->tsite = tsite; h->hkind = hkind; h->hsite = hsite; h->via = via; h->n = 1; return; }
    if (h->tsite == tsite && h->hkind == hkind && h->hsite == hsite && h->via == via) { h->n++; return; }
  }
}
SCR_CYCEN_FN void scr_cycen_scan_words(const void *base, unsigned long long bytes, unsigned hsite, const void *hkind, unsigned via, const void *haddr) {
  const unsigned long long *w = (const unsigned long long *)base;
  for (unsigned long long i = 0; i < bytes / 8; i++) {
    unsigned long long c = w[i] & 0x0000FFFFFFFFFFF8ULL;
    if (c < 4096ULL) continue;
    unsigned j = scr_cycen_hs_find(c, 0);
    if (j == (unsigned)-1) continue;
    if (scr_cycen_hs_found[j] == 0) { scr_cycen_hs_hk[j] = hkind; scr_cycen_hs_hsite[j] = hsite; scr_cycen_hs_via[j] = via; scr_cycen_hs_hp[j] = haddr; }
    scr_cycen_hs_found[j]++;
    scr_cycen_hold_add(scr_cycen_hs_site[j], hkind, hsite, via);
  }
}
SCR_CYCEN_FN void scr_cycen_holders(void) {
  const void *dk = scr_cycen_dyn_key();
  for (unsigned i = 0; i < SCR_CYCEN_HSET; i++) { scr_cycen_hs_key[i] = 0; scr_cycen_hs_found[i] = 0; }
  scr_cycen_nsn = 0;
  for (unsigned i = 0; i < SCR_CYCEN_HOLDSLOTS; i++) { scr_cycen_hold[i].n = 0; scr_cycen_holdt[i].ntargets = 0; }
  for (unsigned i = 0; i < SCR_CYCEN_PSLOTS; i++) {
    ScrCyCenPtr *e = &scr_cycen_ptbl[i];
    if (e->p == NULL || e->row >= SCR_CYCEN_SLOTS) continue;
    unsigned eks = 0; char kb[24]; unsigned long long rc = 0, e0 = 0;
    int isdyn = scr_cycen_tbl[e->row].key == dk;
#if SCR_CYCEN_HOLD_CHAIN
    int istarget = 1; /* every live cyc object is a node of the holder graph */
    if (isdyn) (void)scr_cycen_dyn_peek3(e->p, &eks, kb, &rc, &e0);
#else
    if (!isdyn) continue;
    int istarget = scr_cycen_dyn_peek3(e->p, &eks, kb, &rc, &e0) == SCR_CYCEN_HOLD_KIND;
    if (!istarget) continue;
#endif
    unsigned j = scr_cycen_hs_find((unsigned long long)(size_t)((const char *)e->p + scr_cycen_hdr_bytes), 1);
    if (j != (unsigned)-1) {
      scr_cycen_hs_site[j] = e->site; scr_cycen_hs_rc[j] = rc == (unsigned long long)-1 ? 0 : rc;
      scr_cycen_hs_hk[j] = NULL; scr_cycen_hs_hsite[j] = 0; scr_cycen_hs_via[j] = 0; scr_cycen_hs_hp[j] = NULL; scr_cycen_hs_selfk[j] = scr_cycen_tbl[e->row].key;
#if SCR_CYCEN_HOLD_KIND == 3 && !defined(SCR_CYCEN_RAWSTR)
      if (isdyn) { static unsigned long long ordinal; if (i == 0) ordinal = 0;
        if (((ordinal++) % SCR_CYCEN_SNSTRIDE) == 0 && scr_cycen_nsn < SCR_CYCEN_NSN) {
          unsigned slen = 0, scap = 0; int imm = 0; unsigned long long src = 0, hh = 0; const char *sdata = NULL;
          if (scr_cycen_dyn_peek_str(e->p, &slen, &scap, &imm, &src, &hh, &sdata)) {
            ScrCyCenSN *s = &scr_cycen_sn[scr_cycen_nsn++];
            s->tsite = e->site; s->len = slen; s->slot = j; s->noderc = rc; s->strrc = src;
            unsigned c = slen < 40u ? slen : 40u;
            for (unsigned q = 0; q < c; q++) { char ch = sdata[q]; s->txt[q] = (ch >= 32 && ch < 127 && ch != '|') ? ch : '.'; }
            s->txt[c] = 0;
          }
        } }
#endif
    }
  }
#ifdef SCR_CYCEN_RAWSTR
  /* LAB (holdraw), never lands: targets are the live HEAP STRINGS of the string census (scr_str_census.h must be included BEFORE this header). A sample
   * is every SCR_CYCEN_RSTRIDE-th live string with a non-trivial length; the scan below then finds its holders, and chain mode follows them up.
   * ScrStr layout (the census's own LAYOUT line): rc u32 @0, len u32 @4, cap u32 @8, data @12. */
  { unsigned long long ord = 0;
    for (unsigned ti = 0; ti < SCR_STRCEN_PSLOTS && scr_cycen_nsn < SCR_CYCEN_NSN; ti++) {
      const unsigned char *sp = (const unsigned char *)scr_strcen_ptbl[ti];
      if (sp == NULL) continue;
      unsigned srcn = *(const unsigned *)(sp + 0), slen2 = *(const unsigned *)(sp + 4);
      if (slen2 < SCR_CYCEN_RMINLEN) continue;
      if ((ord++ % SCR_CYCEN_RSTRIDE) != 0) continue;
      unsigned j = scr_cycen_hs_find((unsigned long long)(size_t)sp, 1);
      if (j == (unsigned)-1) continue;
      scr_cycen_hs_site[j] = 0; scr_cycen_hs_rc[j] = srcn; scr_cycen_hs_hk[j] = NULL; scr_cycen_hs_hsite[j] = 0; scr_cycen_hs_via[j] = 0; scr_cycen_hs_hp[j] = NULL; scr_cycen_hs_selfk[j] = NULL;
      ScrCyCenSN *s = &scr_cycen_sn[scr_cycen_nsn++];
      s->tsite = 0; s->len = slen2; s->slot = j; s->noderc = srcn; s->strrc = srcn;
      unsigned c = slen2 < 40u ? slen2 : 40u;
      for (unsigned q = 0; q < c; q++) { char ch = (char)sp[12 + q]; s->txt[q] = (ch >= 32 && ch < 127 && ch != '|') ? ch : '.'; }
      s->txt[c] = 0;
    } }
#endif
  for (unsigned i = 0; i < SCR_CYCEN_PSLOTS; i++) {
    ScrCyCenPtr *e = &scr_cycen_ptbl[i];
    if (e->p == NULL) continue;
    const void *hk = e->row < SCR_CYCEN_SLOTS ? scr_cycen_tbl[e->row].key : NULL;
    scr_cycen_scan_words((const char *)e->p + scr_cycen_hdr_bytes, e->size, e->site, hk, 0, (const char *)e->p + scr_cycen_hdr_bytes);
    if (e->row < SCR_CYCEN_SLOTS && scr_cycen_tbl[e->row].key == dk) {
      const void *sb = NULL; unsigned long long sbytes = 0;
      (void)scr_cycen_dyn_side(e->p, &sb, &sbytes);
      if (sb != NULL) scr_cycen_scan_words(sb, sbytes, e->site, hk, 1, (const char *)e->p + scr_cycen_hdr_bytes);
    }
#if SCR_CYCEN_HOLD_CHAIN
    else if (e->row < SCR_CYCEN_SLOTS) {
      const void *sb2 = NULL; unsigned long long sbytes2 = 0;
      if (scr_cycen_arr_side(hk, e->p, &sb2, &sbytes2) || scr_cycen_map_side(hk, e->p, &sb2, &sbytes2)) {
        if (sb2 != NULL) scr_cycen_scan_words(sb2, sbytes2, e->site, hk, 1, (const char *)e->p + scr_cycen_hdr_bytes);
      }
    }
#endif
  }
  for (unsigned q = 0; q < scr_cycen_nsn; q++) {
    ScrCyCenSN *s = &scr_cycen_sn[q];
    s->found = scr_cycen_hs_found[s->slot]; s->hkind = scr_cycen_hs_hk[s->slot]; s->hsite = scr_cycen_hs_hsite[s->slot]; s->via = scr_cycen_hs_via[s->slot];
    s->nchain = 0;
#if SCR_CYCEN_HOLD_CHAIN
    { unsigned slot = s->slot;
      for (unsigned lv = 0; lv < SCR_CYCEN_CHAINMAX; lv++) {
        const void *h = scr_cycen_hs_hp[slot]; if (h == NULL) break;
        unsigned hj = scr_cycen_hs_find((unsigned long long)(size_t)h, 0); if (hj == (unsigned)-1) break;
        s->chk[s->nchain] = scr_cycen_hs_selfk[hj]; s->chs[s->nchain] = scr_cycen_hs_site[hj]; s->nchain++; slot = hj;
      } }
#endif
  }
  for (unsigned i = 0; i < SCR_CYCEN_HSET; i++) {
    if (scr_cycen_hs_key[i] == 0) continue;
    unsigned ts = scr_cycen_hs_site[i];
    unsigned m = SCR_CYCEN_HOLDSLOTS - 1u, j = (ts * 2654435761u >> 7) & m;
    for (unsigned t = 0; t < SCR_CYCEN_HOLDSLOTS; t++, j = (j + 1u) & m) {
      ScrCyCenHoldT *h = &scr_cycen_holdt[j];
      if (h->ntargets == 0) { h->tsite = ts; h->rcsum = h->found = h->unexplained = h->norefs = 0; }
      else if (h->tsite != ts) continue;
      h->ntargets++; h->rcsum += (long long)scr_cycen_hs_rc[i]; h->found += scr_cycen_hs_found[i];
      if (scr_cycen_hs_rc[i] > scr_cycen_hs_found[i]) h->unexplained += (long long)(scr_cycen_hs_rc[i] - scr_cycen_hs_found[i]);
      if (scr_cycen_hs_found[i] == 0) h->norefs++;
      break;
    }
  }
}

/* One pass over the pointer table: the census's own view of the live population, aggregated. */
SCR_CYCEN_FN void scr_cycen_x_aggregate(void) {
  const void *dk = scr_cycen_dyn_key();
  scr_cycen_x_small_n = scr_cycen_x_small_phys = scr_cycen_x_big_n = scr_cycen_x_big_phys = 0;
  scr_cycen_dyn_total_n = scr_cycen_dyn_total_b = 0;
  for (unsigned i = 0; i < SCR_CYCEN_SKSLOTS; i++) { scr_cycen_sk[i].key = 0; scr_cycen_sk[i].n = 0; scr_cycen_sk[i].bytes = 0; }
  for (unsigned i = 0; i < SCR_CYCEN_SHSLOTS; i++) scr_cycen_sh[i].key = 0;
  for (int k = 0; k < 32; k++) for (int b = 0; b < SCR_CYCEN_LB; b++) scr_cycen_shape[k][b][0] = scr_cycen_shape[k][b][1] = 0;
  for (unsigned i = 0; i < SCR_CYCEN_STRSLOTS; i++) { scr_cycen_str[i].key = 0; scr_cycen_str[i].n = scr_cycen_str[i].nimm = scr_cycen_str[i].sumlen = scr_cycen_str[i].sumphys = scr_cycen_str[i].nshared = scr_cycen_str[i].ndistinct = 0; }
  for (unsigned i = 0; i < SCR_CYCEN_DSET; i++) scr_cycen_dset[i] = 0;
  for (unsigned i = 0; i < SCR_CYCEN_STRSLOTS; i++) { for (int h = 0; h < 65; h++) scr_cycen_strx[i].lenhist[h] = 0; scr_cycen_strx[i].nsamp = 0; }
  scr_cycen_str_total = scr_cycen_str_distinct = 0;
  for (unsigned i = 0; i < SCR_CYCEN_AKSLOTS; i++) { scr_cycen_ak[i].key = 0; scr_cycen_ak[i].n = scr_cycen_ak[i].phys = scr_cycen_ak[i].ext = 0; }
  scr_cycen_ak_phys = 0;
  for (unsigned i = 0; i < SCR_CYCEN_PSLOTS; i++) {
    ScrCyCenPtr *e = &scr_cycen_ptbl[i];
    if (e->p == NULL) continue;
    if (e->phys <= 256u) { scr_cycen_x_small_n++; scr_cycen_x_small_phys += e->phys; }
    else { scr_cycen_x_big_n++; scr_cycen_x_big_phys += e->phys; }
    {
      unsigned long long akey = (((unsigned long long)e->site << 13) | (e->row & 8191u)) + 1ULL;
      unsigned am = SCR_CYCEN_AKSLOTS - 1u, aj = (unsigned)((akey * 0x9E3779B97F4A7C15ULL) >> 40) & am;
      unsigned long long ext = 0;
      if (e->row < SCR_CYCEN_SLOTS && scr_cycen_tbl[e->row].key == dk) { unsigned l2 = 0, c2 = 0; (void)scr_cycen_dyn_peek2(e->p, &l2, &c2, &ext); }
      for (unsigned t = 0; t < SCR_CYCEN_AKSLOTS; t++, aj = (aj + 1u) & am) {
        if (scr_cycen_ak[aj].key == 0) { scr_cycen_ak[aj].key = akey; scr_cycen_ak[aj].kind = e->row < SCR_CYCEN_SLOTS ? scr_cycen_tbl[e->row].key : NULL; }
        if (scr_cycen_ak[aj].key != akey) continue;
        scr_cycen_ak[aj].n++; scr_cycen_ak[aj].phys += e->phys; scr_cycen_ak[aj].ext += (long long)ext; scr_cycen_ak_phys += e->phys;
        break;
      }
    }
    if (e->row < SCR_CYCEN_SLOTS && scr_cycen_tbl[e->row].key == dk) {
      unsigned len = 0; int kind = scr_cycen_dyn_peek(e->p, &len);
      int b = scr_cycen_lbucket(len); if (b >= SCR_CYCEN_LB) b = SCR_CYCEN_LB - 1;
      scr_cycen_dyn_total_n++; scr_cycen_dyn_total_b += e->phys;
      scr_cycen_sk_add(e->site, kind, (long long)e->phys);
      if (kind == 4 || kind == 5) { unsigned l3 = 0, c3 = 0, eks = 0; unsigned long long x3 = 0, rc3 = 0, e0 = 0; char kb[24]; (void)scr_cycen_dyn_peek2(e->p, &l3, &c3, &x3); (void)scr_cycen_dyn_peek3(e->p, &eks, kb, &rc3, &e0); scr_cycen_sh_add(e->site, kind, l3, c3, eks, x3, rc3, e0, kb); }
      if (kind >= 0 && kind < 32) { scr_cycen_shape[kind][b][0]++; scr_cycen_shape[kind][b][1] += e->phys; }
      if (kind == 3) {
        unsigned slen = 0, scap = 0; int imm = 0; unsigned long long rc = 0, hh = 0; const char *sdata = NULL;
        if (scr_cycen_dyn_peek_str(e->p, &slen, &scap, &imm, &rc, &hh, &sdata)) {
          unsigned skey = e->site + 1u, smask = SCR_CYCEN_STRSLOTS - 1u, sj = (skey * 2654435761u >> 9) & smask;
          for (unsigned t = 0; t < SCR_CYCEN_STRSLOTS; t++, sj = (sj + 1u) & smask) {
            if (scr_cycen_str[sj].key == 0) scr_cycen_str[sj].key = skey;
            if (scr_cycen_str[sj].key != skey) continue;
            ScrCyCenStr *r = &scr_cycen_str[sj];
            r->n++;
            scr_cycen_strx[sj].lenhist[slen < 64u ? slen : 64u]++;
            scr_cycen_str_total++;
            if (imm) r->nimm++;
            else { r->sumlen += slen; r->sumphys += (long long)((12u + scap + 1u + 7u) & ~7u); if (rc > 1) r->nshared++; }
            /* distinct content per site: a 64-bit (site, content) key in an open-addressed set */
            unsigned long long dk = (hh ^ ((unsigned long long)skey * 0x9E3779B97F4A7C15ULL)) | 1ULL;
            unsigned dm = SCR_CYCEN_DSET - 1u, dj = (unsigned)(dk >> 11) & dm;
            for (unsigned u = 0; u < 64u; u++, dj = (dj + 1u) & dm) {
              if (scr_cycen_dset[dj] == 0) {
                scr_cycen_dset[dj] = dk; r->ndistinct++; scr_cycen_str_distinct++;
                ScrCyCenStrX *x = &scr_cycen_strx[sj];
                if (!imm && x->nsamp < SCR_CYCEN_NSAMP) { unsigned c = slen < 47u ? slen : 47u; x->samp[x->nsamp].len = slen; for (unsigned q = 0; q < c; q++) x->samp[x->nsamp].txt[q] = sdata[q]; x->samp[x->nsamp].txt[c] = 0; x->nsamp++; }
                break;
              }
              if (scr_cycen_dset[dj] == dk) break;
            }
            break;
          }
        }
      }
    }
  }
}

SCR_CYCEN_FN void scr_cycen_seam_x(int force);
SCR_CYCEN_FN void scr_cycen_seam(void) { scr_cycen_seam_x(1); }
/* LAB: the same probe at the START of a collector pass, where send_group's live set is at its largest (the idle seam only exists between turns), without the forced collection */
SCR_CYCEN_FN void scr_cycen_seam_pass(void) { if (getenv("SCR_CYCEN_PROBE_PASS") != NULL) scr_cycen_seam_x(0); }
SCR_CYCEN_FN void scr_cycen_seam_x(int force) {
  if (scr_cycen_pr_busy || scr_cycen_pr_n >= SCR_CYCEN_PROBE_MAX) return;
  if (getenv("SCR_CYCEN_PROBE") == NULL) return;
  long long live = scr_cycen_live_phys;
  if (live < (long long)SCR_CYCEN_PROBE_MIN) return;
  if (getenv("SCR_CYCEN_PROBE_FORCE") == NULL && live * 100 < scr_cycen_pr_last * (100 + SCR_CYCEN_PROBE_STEP)) return; /* FORCE: probe at every seam (micro controls) */
  scr_cycen_pr_busy = 1;
  scr_cycen_pr_last = live;
  long long rows = scr_cycen_rows;
  long long bN = scr_cycen_live_n, bP = scr_cycen_live_phys;
  int will_be_best = bP > scr_cycen_pr_best_before || getenv("SCR_CYCEN_PROBE_LAST") != NULL; /* LAST: report the last probe (micro controls) */
  for (long long i = 0; i < rows; i++) {
    ScrCyCenRow *r = &scr_cycen_tbl[scr_cycen_order[i]];
    scr_cycen_pr_hn[i] = r->live_n;
    scr_cycen_pr_hp[i] = r->live_phys;
    scr_cycen_pr_hanc[i] = (long long)(size_t)r->key;
  }
  /* THE SAME INSTANT: arena walk, census aggregation and park counters, all before the forced collection. */
  scr_cycen_ar_held_cur = scr_cycen_arena_walk(scr_cycen_ar_cur, SCR_CYCEN_NCLASS);
  if (will_be_best) scr_cycen_x_aggregate();
  if (will_be_best) { scr_cycen_holders(); for (unsigned q = 0; q < SCR_CYCEN_HOLDSLOTS; q++) { scr_cycen_hold_best[q] = scr_cycen_hold[q]; scr_cycen_holdt_best[q] = scr_cycen_holdt[q]; } for (unsigned q = 0; q < scr_cycen_nsn; q++) scr_cycen_sn_best[q] = scr_cycen_sn[q]; scr_cycen_nsn_best = scr_cycen_nsn; }
  if (force) scr_collect_cycles();
  long long aN = scr_cycen_live_n, aP = scr_cycen_live_phys;
  long long k = scr_cycen_pr_n++;
  scr_cycen_pr_sum[k][0] = scr_cycen_alloc_total;
  scr_cycen_pr_sum[k][1] = bN; scr_cycen_pr_sum[k][2] = bP;
  scr_cycen_pr_sum[k][3] = aN; scr_cycen_pr_sum[k][4] = aP;
  scr_cycen_pr_sum[k][5] = scr_cycen_live_peak;
  if (will_be_best) {
    scr_cycen_pr_best_before = bP; scr_cycen_pr_best = k; scr_cycen_pr_rows = rows;
    for (long long i = 0; i < rows; i++) {
      ScrCyCenRow *r = &scr_cycen_tbl[scr_cycen_order[i]];
      scr_cycen_pr_bn[i] = scr_cycen_pr_hn[i]; scr_cycen_pr_bp[i] = scr_cycen_pr_hp[i];
      scr_cycen_pr_an[i] = r->live_n; scr_cycen_pr_ap[i] = r->live_phys;
    }
    for (int c = 0; c < SCR_CYCEN_NCLASS; c++) for (int q = 0; q < 13; q++) scr_cycen_ar_best[c][q] = scr_cycen_ar_cur[c][q];
    scr_cycen_ar_held_best = scr_cycen_ar_held_cur;
    scr_cycen_x_best[0] = scr_cycen_x_small_n; scr_cycen_x_best[1] = scr_cycen_x_small_phys;
    scr_cycen_x_best[2] = scr_cycen_x_big_n; scr_cycen_x_best[3] = scr_cycen_x_big_phys;
    scr_cycen_dyn_total_best_n = scr_cycen_dyn_total_n; scr_cycen_dyn_total_best_b = scr_cycen_dyn_total_b;
    for (unsigned q = 0; q < SCR_CYCEN_SKSLOTS; q++) scr_cycen_sk_best[q] = scr_cycen_sk[q];
    for (unsigned q = 0; q < SCR_CYCEN_SHSLOTS; q++) scr_cycen_sh_best[q] = scr_cycen_sh[q];
    for (unsigned q = 0; q < SCR_CYCEN_STRSLOTS; q++) { scr_cycen_str_best[q] = scr_cycen_str[q]; scr_cycen_strx_best[q] = scr_cycen_strx[q]; }
    for (unsigned q = 0; q < SCR_CYCEN_AKSLOTS; q++) scr_cycen_ak_best[q] = scr_cycen_ak[q];
    scr_cycen_ak_phys_best = scr_cycen_ak_phys;
    scr_cycen_str_total_best = scr_cycen_str_total; scr_cycen_str_distinct_best = scr_cycen_str_distinct;
    for (int a = 0; a < 32; a++) for (int b = 0; b < SCR_CYCEN_LB; b++) { scr_cycen_shape_best[a][b][0] = scr_cycen_shape[a][b][0]; scr_cycen_shape_best[a][b][1] = scr_cycen_shape[a][b][1]; }
    scr_cycen_x_park_best[0] = scr_cycen_park_n; scr_cycen_x_park_best[1] = scr_cycen_park_phys; scr_cycen_x_park_best[2] = scr_cycen_park_side;
    scr_cycen_x_dynfree_best = scr_cycen_dyn_free_count();
  }
  scr_cycen_pr_busy = 0;
}

SCR_CYCEN_FN void scr_cycen_report(void) {
  if (scr_cycen_reported) return;
  scr_cycen_reported = 1;
  {
    const char *path = getenv("SCR_CYCEN_OUT");
    FILE *f = fopen(path && *path ? path : "scr-cycen.txt", "w");
    if (!f) return;
    fprintf(f, "CYCEN-KIND cycle hdr=%lld anchor=%llx\n", scr_cycen_hdr_bytes,
            (unsigned long long)(size_t)&scr_collect_cycles);
    for (long long i = 0; i < scr_cycen_rows; i++) {
      ScrCyCenRow *r = &scr_cycen_tbl[scr_cycen_order[i]];
      fprintf(f,
              "CYCEN %lld %lld %lld %lld %lld %lld %lld %lld %lld %lld %lld %lld %lld %lld "
              "%lld %lld %lld %lld %lld %lld %llx\n",
              r->n_alloc, r->n_free, r->n_pool_hit, r->n_pool_give, r->bytes_ever,
              r->live_n, r->live_phys, r->live_payload, r->snap_n, r->snap_phys,
              r->snap_payload, r->size_min, r->size_max, r->size_sum,
              r->park_n, r->park_phys, r->park_side, r->snap_park_n, r->snap_park_phys,
              r->snap_park_side, (unsigned long long)(size_t)r->key);
    }
    for (long long i = 0; i < scr_cycen_ncurve; i++) {
      fprintf(f, "CYCEN-CURVE %lld %lld %lld %lld %lld %lld %lld\n", i, scr_cycen_curve[i][0],
              scr_cycen_curve[i][1], scr_cycen_curve[i][2], scr_cycen_curve[i][3],
              scr_cycen_curve[i][4], scr_cycen_curve[i][5]);
    }
    if (scr_cycen_pr_best >= 0) {
      fprintf(f, "CYCEN-ARENA-HELD best=%lld held=%lld\n", scr_cycen_pr_best, scr_cycen_ar_held_best);
      for (int c = 0; c < SCR_CYCEN_NCLASS; c++) {
        long long *a = scr_cycen_ar_best[c];
        if (a[0] == 0) continue;
        fprintf(f, "CYCEN-ARENA class=%d stride=%lld chunks=%lld chunkB=%lld liveB=%lld freeB=%lld goneB=%lld uncarvedB=%lld partialChunks=%lld partialB=%lld liveBlocks=%lld freeBlocks=%lld curChunks=%lld hdrB=%lld\n",
                c, a[8], a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[9], a[10], a[11], a[12]);
      }
      fprintf(f, "CYCEN-X smallN=%lld smallPhys=%lld bigN=%lld bigPhys=%lld parkN=%lld parkPhys=%lld parkSide=%lld dynFreeList=%lld dynNodesN=%lld dynNodesB=%lld sitesLost=%lld nsites=%u\n",
              scr_cycen_x_best[0], scr_cycen_x_best[1], scr_cycen_x_best[2], scr_cycen_x_best[3],
              scr_cycen_x_park_best[0], scr_cycen_x_park_best[1], scr_cycen_x_park_best[2], scr_cycen_x_dynfree_best,
              scr_cycen_dyn_total_best_n, scr_cycen_dyn_total_best_b, scr_cycen_site_lost, scr_cycen_nsites);
      for (unsigned q = 0; q < SCR_CYCEN_SKSLOTS; q++) {
        if (scr_cycen_sk_best[q].key == 0) continue;
        unsigned key = scr_cycen_sk_best[q].key - 1u, site = key >> 5;
        fprintf(f, "CYCEN-DYNSITE kind=%u n=%lld bytes=%lld", key & 31u, scr_cycen_sk_best[q].n, scr_cycen_sk_best[q].bytes);
        for (int d = 0; d < SCR_CYCEN_SITE_DEPTH; d++) fprintf(f, " %llx", site ? scr_cycen_sites[site][d] : 0ULL);
        fprintf(f, "\n");
      }
      for (unsigned q = 0; q < SCR_CYCEN_SHSLOTS; q++) {
        const ScrCyCenSh *r = &scr_cycen_sh_best[q];
        if (r->key == 0) continue;
        fprintf(f, "CYCEN-SHAPE kind=%u len=%u cap=%u eks=%08x n=%lld ext=%lld rcsum=%lld e0shared=%lld keys=%s", r->kind, r->len, r->cap, r->eks, r->n, r->ext, r->rcsum, r->e0shared, r->keys[0] ? r->keys : "-");
        for (int d = 0; d < SCR_CYCEN_SITE_DEPTH; d++) fprintf(f, " %llx", r->site ? scr_cycen_sites[r->site][d] : 0ULL);
        fprintf(f, "\n");
      }
      for (unsigned q = 0; q < SCR_CYCEN_HOLDSLOTS; q++) {
        const ScrCyCenHoldT *h = &scr_cycen_holdt_best[q];
        if (h->ntargets == 0) continue;
        fprintf(f, "CYCEN-HOLDT ntargets=%lld rcsum=%lld found=%lld unexplained=%lld norefs=%lld", h->ntargets, h->rcsum, h->found, h->unexplained, h->norefs);
        for (int d = 0; d < SCR_CYCEN_SITE_DEPTH; d++) fprintf(f, " %llx", h->tsite ? scr_cycen_sites[h->tsite][d] : 0ULL);
        fprintf(f, "\n");
      }
      for (unsigned q = 0; q < SCR_CYCEN_HOLDSLOTS; q++) {
        const ScrCyCenHold *h = &scr_cycen_hold_best[q];
        if (h->n == 0) continue;
        fprintf(f, "CYCEN-HOLD n=%lld via=%u hkind=%llx tsite", h->n, h->via, (unsigned long long)(size_t)h->hkind);
        for (int d = 0; d < SCR_CYCEN_SITE_DEPTH; d++) fprintf(f, " %llx", h->tsite ? scr_cycen_sites[h->tsite][d] : 0ULL);
        fprintf(f, " hsite");
        for (int d = 0; d < SCR_CYCEN_SITE_DEPTH; d++) fprintf(f, " %llx", h->hsite ? scr_cycen_sites[h->hsite][d] : 0ULL);
        fprintf(f, "\n");
      }
      for (unsigned q = 0; q < scr_cycen_nsn_best; q++) {
        const ScrCyCenSN *s = &scr_cycen_sn_best[q];
        fprintf(f, "CYCEN-SN noderc=%llu strrc=%llu len=%u found=%u via=%u hkind=%llx tsite", s->noderc, s->strrc, s->len, s->found, s->via, (unsigned long long)(size_t)s->hkind);
        for (int d = 0; d < SCR_CYCEN_SITE_DEPTH; d++) fprintf(f, " %llx", s->tsite ? scr_cycen_sites[s->tsite][d] : 0ULL);
        fprintf(f, " hsite");
        for (int d = 0; d < SCR_CYCEN_SITE_DEPTH; d++) fprintf(f, " %llx", s->hsite ? scr_cycen_sites[s->hsite][d] : 0ULL);
        fprintf(f, " |%s|\n", s->txt);
        for (unsigned lv = 0; lv < s->nchain; lv++) {
          fprintf(f, "CYCEN-CH q=%u lv=%u hkind=%llx site", q, lv, (unsigned long long)(size_t)s->chk[lv]);
          for (int d = 0; d < SCR_CYCEN_SITE_DEPTH; d++) fprintf(f, " %llx", s->chs[lv] ? scr_cycen_sites[s->chs[lv]][d] : 0ULL);
          fprintf(f, "\n");
        }
      }
      fprintf(f, "CYCEN-STRTOTAL nodes=%lld distinctSiteContents=%lld\n", scr_cycen_str_total_best, scr_cycen_str_distinct_best);
      fprintf(f, "CYCEN-ALLTOTAL phys=%lld\n", scr_cycen_ak_phys_best);
      for (unsigned q = 0; q < SCR_CYCEN_AKSLOTS; q++) {
        ScrCyCenAK *r = &scr_cycen_ak_best[q];
        if (r->key == 0) continue;
        unsigned site = (unsigned)((r->key - 1ULL) >> 13);
        fprintf(f, "CYCEN-ALL n=%lld phys=%lld ext=%lld kind=%llx", r->n, r->phys, r->ext, (unsigned long long)(size_t)r->kind);
        for (int d = 0; d < SCR_CYCEN_SITE_DEPTH; d++) fprintf(f, " %llx", site ? scr_cycen_sites[site][d] : 0ULL);
        fprintf(f, "\n");
      }
      for (unsigned q = 0; q < SCR_CYCEN_STRSLOTS; q++) {
        ScrCyCenStr *r = &scr_cycen_str_best[q];
        if (r->key == 0) continue;
        unsigned site = r->key - 1u;
        fprintf(f, "CYCEN-STR n=%lld nimm=%lld sumlen=%lld sumphys=%lld nshared=%lld ndistinct=%lld", r->n, r->nimm, r->sumlen, r->sumphys, r->nshared, r->ndistinct);
        for (int d = 0; d < SCR_CYCEN_SITE_DEPTH; d++) fprintf(f, " %llx", site ? scr_cycen_sites[site][d] : 0ULL);
        fprintf(f, "\n");
        ScrCyCenStrX *x = &scr_cycen_strx_best[q];
        fprintf(f, "CYCEN-STRLEN q=%u", q);
        for (int h = 0; h < 65; h++) if (x->lenhist[h]) fprintf(f, " %d:%u", h, x->lenhist[h]);
        fprintf(f, "\n");
        for (unsigned k = 0; k < x->nsamp; k++) {
          fprintf(f, "CYCEN-STRSAMP q=%u len=%u |", q, x->samp[k].len);
          for (const char *c = x->samp[k].txt; *c; c++) fputc((*c >= 32 && *c < 127 && *c != '|') ? *c : '.', f);
          fprintf(f, "|\n");
        }
      }
      for (int a = 0; a < 32; a++) for (int b = 0; b < SCR_CYCEN_LB; b++)
        if (scr_cycen_shape_best[a][b][0]) fprintf(f, "CYCEN-DYNSHAPE kind=%d lenrow=%d n=%lld bytes=%lld\n", a, b, scr_cycen_shape_best[a][b][0], scr_cycen_shape_best[a][b][1]);
    }
    for (long long k = 0; k < scr_cycen_pr_n; k++)
      fprintf(f, "CYCEN-PROBE %lld alloc=%lld beforeN=%lld beforePhys=%lld afterN=%lld afterPhys=%lld livePeakSoFar=%lld\n",
              k, scr_cycen_pr_sum[k][0], scr_cycen_pr_sum[k][1], scr_cycen_pr_sum[k][2],
              scr_cycen_pr_sum[k][3], scr_cycen_pr_sum[k][4], scr_cycen_pr_sum[k][5]);
    for (long long i = 0; i < scr_cycen_pr_rows && scr_cycen_pr_best >= 0; i++)
      fprintf(f, "CYCEN-PROBE-ROW best=%lld %lld %lld %lld %lld %llx\n", scr_cycen_pr_best,
              scr_cycen_pr_bn[i], scr_cycen_pr_bp[i], scr_cycen_pr_an[i], scr_cycen_pr_ap[i],
              (unsigned long long)scr_cycen_pr_hanc[i]);
    fprintf(f,
            "CYCEN-TOTAL rows=%lld allocs=%lld frees=%lld liveN=%lld livePhys=%lld "
            "livePayload=%lld poolN=%lld poolPhys=%lld osPeak=%lld osPeakN=%lld "
            "livePeak=%lld poolPeak=%lld liveAtPeak=%lld poolAtPeak=%lld snapOrd=%lld "
            "snapOs=%lld snapBand=%lld snaps=%lld lost=%lld ptrLost=%lld freeUnknown=%lld ptrLive=%lld "
            "ptrLivePeak=%lld pslots=%u cycLive=%lld armPhys=%lld parkN=%lld "
            "parkPhys=%lld parkSide=%lld parkPeak=%lld parkAtPeak=%lld "
            "parkNAtPeak=%lld parkSideAtPeak=%lld parkUnknown=%lld tableBytes=%lld\n",
            scr_cycen_rows, scr_cycen_alloc_total, scr_cycen_free_total, scr_cycen_live_n,
            scr_cycen_live_phys, scr_cycen_live_payload, scr_cycen_pool_n,
            scr_cycen_pool_phys, scr_cycen_os_peak, scr_cycen_os_peak_n,
            scr_cycen_live_peak, scr_cycen_pool_peak, scr_cycen_live_at_peak,
            scr_cycen_pool_at_peak, scr_cycen_snap_ord, scr_cycen_snap_os,
            (long long)SCR_CYCEN_SNAP_MIN, scr_cycen_snaps, scr_cycen_lost,
            scr_cycen_ptr_lost, scr_cycen_free_unknown, scr_cycen_ptr_live,
            scr_cycen_ptr_live_peak, (unsigned)SCR_CYCEN_PSLOTS, scr_cycen_seen_live,
            scr_cycen_arm_phys, scr_cycen_park_n, scr_cycen_park_phys,
            scr_cycen_park_side, scr_cycen_park_peak, scr_cycen_park_at_peak,
            scr_cycen_park_n_at_peak, scr_cycen_park_side_at_peak,
            scr_cycen_park_unknown,
            (long long)(sizeof scr_cycen_tbl + sizeof scr_cycen_ptbl +
                        sizeof scr_cycen_curve));
    fclose(f);
  }
}

/* atexit alone cannot report on this target: zapo's entry ends in
 * process.exit(0), which lowers to _Exit and skips every atexit handler.
 * The interposer below closes that. When scr_prof.h is also -include'd it
 * has already defined _Exit; chaining onto it rather than redefining keeps
 * BOTH reports, which is what makes the cross-check in §"controls"
 * possible — the same binary produces this census and scr_prof's own
 * independent count of the same calloc. */
__attribute__((constructor)) SCR_CYCEN_FN void scr_cycen_install(void) {
  static int done = 0;
  if (done) return;
  done = 1;
  atexit(scr_cycen_report);
}

#ifdef _Exit
#undef _Exit
#define _Exit(c) (scr_cycen_report(), scr_prof_report(), _Exit(c))
#else
#define _Exit(c) (scr_cycen_report(), _Exit(c))
#endif

/* ---- the arm ---------------------------------------------------------
 * The lane is believed only when a planted population comes back exactly.
 * -DSCR_CYCEN_ARM=N plants N allocations of 4096 payload bytes at one
 * synthetic key and frees exactly half of them at the OTHER hook, then the
 * reader checks:
 *   the arm row reports n_alloc = N, n_free = N/2, live_n = N - N/2 —
 *     i.e. the frees were charged BACK to the allocating row;
 *   there is NO second row for the freeing path (the negative control:
 *     a lane that keyed frees by where they happen would create one);
 *   ptrLost = 0 and freeUnknown = 0.
 * The addresses handed to the hooks are inside a static array, so they are
 * real, unique, and can never collide with a block the allocator returns.
 * The arm's bytes are reported as armPhys so every figure downstream can
 * subtract a known constant rather than a guessed one. */
#ifdef SCR_CYCEN_ARM
SCR_CYCEN_SHARED char scr_cycen_arm_key = 0;
SCR_CYCEN_SHARED char scr_cycen_arm_blk[SCR_CYCEN_ARM * 8] = {0};
__attribute__((constructor)) SCR_CYCEN_FN void scr_cycen_arm_ctor(void) {
  /* a constructor is emitted in EVERY TU; this must run once. */
  if (scr_cycen_armed) return;
  scr_cycen_armed = 1;
  for (int i = 0; i < SCR_CYCEN_ARM; i++)
    scr_cycen_note_alloc(&scr_cycen_arm_blk[i * 8], 4096, 4096 - 32,
                         &scr_cycen_arm_key, 0, 0);
  for (int i = 0; i < SCR_CYCEN_ARM / 2; i++)
    scr_cycen_note_free(&scr_cycen_arm_blk[i * 8], 0, 0);
  scr_cycen_arm_phys = (long long)(SCR_CYCEN_ARM - SCR_CYCEN_ARM / 2) * 4096;
}
#endif

#endif /* SCR_CYC_CENSUS_H */
