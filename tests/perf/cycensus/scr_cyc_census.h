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
} ScrCyCenPtr;

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
  for (unsigned k = (hole + 1u) & mask; scr_cycen_ptbl[k].p != NULL; k = (k + 1u) & mask) {
    unsigned ideal = scr_cycen_phash(scr_cycen_ptbl[k].p);
    int blocked = (hole <= k) ? (ideal > hole && ideal <= k) : (ideal > hole || ideal <= k);
    if (blocked) continue;
    scr_cycen_ptbl[hole] = scr_cycen_ptbl[k];
    scr_cycen_ptbl[k].p = NULL;
    scr_cycen_ptbl[k].row = 0;
    scr_cycen_ptbl[k].phys = 0;
    scr_cycen_ptbl[k].size = 0;
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
