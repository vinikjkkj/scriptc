/* scr_chunk_census.h - HOW FULL the arenas' 64 KiB chunks are, one row per
 * chunk, and how many whole free PAGES a page-level decommit could ever
 * hand back.
 *
 * WHY THIS EXISTS, and what it is NOT duplicating.
 *
 * Four instruments in this tree already answer four other questions about
 * the settled heap, and none of them answers this one:
 *
 *   tests/perf/cycstat      counts arena chunks TAKEN and RELEASED. It is
 *                           the reason we know 1,053 chunks became 160. It
 *                           cannot say how full any of them is.
 *   tests/perf/heapcensus   an exact-size histogram of BUSY CRT-heap
 *                           blocks. A chunk appears there as one 65,536-
 *                           byte busy block -- entirely busy, whether it
 *                           holds one live object or eight hundred.
 *   tests/perf/cycensus     live cycle-headered objects by kind. It sees
 *                           the objects and not the chunks they sit in.
 *   tests/perf/memmap       every committed region, classed and joined
 *                           against QueryWorkingSet. A chunk is inside
 *                           class HEAP and is not resolved further.
 *
 * So the one number that decides whether page-level decommit is worth
 * writing -- the free space INSIDE the chunks the process still holds --
 * is not obtainable from any of them, in any combination. A chunk is
 * released only when it is COMPLETELY empty, so 160 chunks at 90% is
 * nothing to recover and 160 at 5% is 9 MiB sitting there, and those two
 * are indistinguishable from every existing report.
 *
 * WHAT IT COSTS TO KNOW. Nothing but arithmetic over bookkeeping the
 * allocators already maintain. ScrCycChunk carries `used`, `stride`,
 * `bump`, `lim` and a chunk-local free list; that is enough to place every
 * live block in the chunk to the byte, with no allocator cooperation and
 * no per-allocation table. This header adds no counter to any allocation
 * path. What it DOES add is a REGISTRY, and that is not an implementation
 * detail:
 *
 *   THE CYCLE ARENA CANNOT ENUMERATE ITS OWN CHUNKS. A chunk that is
 *   neither its class's current chunk nor on scr_cyc_ar_part[] is FULL,
 *   and a full chunk is on NO list at all (scr_cyc_ar_refill: "It stops
 *   being the current chunk and goes on NO list"). There is therefore no
 *   walk of live chunks in the shipping runtime, and any future decommit
 *   pass would have to add exactly the registry this header adds.
 *
 *   THE STRING ARENA CANNOT FREE A CHUNK EVEN IN PRINCIPLE. scr_string.c's
 *   scr_str_ar_take mallocs a 64 KiB chunk and stores the pointer ONLY in
 *   scr_str_ar_cur/scr_str_ar_lim, both of which are overwritten by the
 *   next chunk. The pointer malloc returned does not survive anywhere in
 *   the process, so free() can never be called on it; and its free lists
 *   are GLOBAL per size class, not chunk-local, so nothing could tell when
 *   a chunk had emptied even if the pointer were kept. cycstat's counter
 *   set says the same thing by omission: the cycle arena has `arfree`, the
 *   string arena has no `sarfree`, because there is no free path to count.
 *   The registry here is what makes its occupancy measurable at all.
 *
 * THE TWO CROSS-CHECKS ARE THE INSTRUMENT'S OWN CONTROL, and they run on
 * every snapshot of every run rather than only in an arm:
 *
 *   1. chunks * SCR_CYC_ARENA_CHUNK == scr_cyc_ar_held. The arena keeps
 *      `held` for the budget check, incremented and decremented on paths
 *      this header does not touch. If the registry has missed a chunk or
 *      kept a released one, the two disagree and the snapshot prints
 *      REGCHECK=MISMATCH instead of a total.
 *   2. per chunk, used == carved - freelistLen. `used` is maintained by
 *      the allocator; `carved` is computed from bump; the free list is
 *      WALKED. Three independent quantities, one identity. A chunk that
 *      fails it is reported by index and excluded from the totals.
 *
 * An instrument whose numbers reconcile against the allocator's own
 * counters cannot report a confident wrong answer the way a walk that
 * only ever agrees with itself can.
 *
 * THE PAGE CEILING IS REPORTED TWICE, and the difference between the two
 * is a finding rather than a rounding detail:
 *
 *   ideal  the chunk treated as 16 aligned 4 KiB pages. This is the
 *          ceiling the arena WOULD have if it took its chunks from
 *          VirtualAlloc.
 *   real   pages as they actually fall in the address space. malloc
 *          returns 16-byte alignment, not page alignment, so a 64 KiB
 *          chunk straddles 17 pages and only the ones wholly inside it
 *          are even candidates. This is the ceiling as the code stands.
 *
 * Neither is an estimate of what a decommit would RETURN -- both are hard
 * upper bounds on what one could return, computed from where the live
 * objects actually are. If the ceiling is small, no implementation can
 * beat it, and the route dies here for the price of one run.
 *
 * HOW TO USE IT
 *   SCRIPTC_PROF_CFLAGS="-include <repo>/tests/perf/chunkcensus/scr_chunk_census.h
 *                        -I<repo>/tests/perf/chunkcensus"
 *   SCR_CHUNKCEN_OUT=<file>  where the report goes (default stderr)
 *   SCR_CHUNKCEN_MS=<n>      snapshot period at the loop seam; 0 (the
 *                            default) is the negative control -- the seam
 *                            costs one compare and nothing is walked.
 *   SCR_CHUNKCEN_CHUNKS=0    suppress the per-chunk rows, keep the totals
 *
 * THE SEAM IS scr_loop_run's, NOT A THREAD. tests/perf/memmap walks the
 * address space from a background thread, which is sound for VirtualQuery
 * and HeapWalk because the kernel and the heap lock serialise them. It
 * would NOT be sound here: the arenas are mutated by the main thread under
 * no lock at all, and a walk landing between the two stores of a free-list
 * push would read a cycle. So this hooks the seam scr_heap_trim and
 * scr_fiber_pool_decay already use -- the loop has decided it has no
 * runnable work and is about to block, which is the one point at which a
 * whole-arena walk cannot land inside a turn.
 *
 * AND IT CAPS THE SLEEP, which both of those seam users learned the hard
 * way (scr_stack_pool_decay_due): a process whose only pending work is one
 * long timer takes the whole timer in a single turn, so a window that
 * ticks once per turn never runs and the measurement comes back looking
 * like an instrument that found nothing.
 *
 * THIS HEADER CANNOT SEE EITHER CHUNK TYPE. It is -include'd, so it is
 * processed before scr_runtime.h and before scr_cycle.c's own
 * declarations. It therefore holds the STATE, the seam and the REPORT; the
 * two walks live in scr_chunk_census_walk.h (included by scr_cycle.c) and
 * scr_str_chunk_walk.h (included by scr_string.c), each from inside that
 * file's own #ifdef SCR_CHUNKCEN_ON. That is the split tests/perf/dyncensus
 * established, for the same reason.
 *
 * NO <windows.h>, for tests/perf/cycensus's reason: a force-included header
 * that pulls it in collides with scr_fetch_dispatch.c on fd_set.
 */
#ifndef SCR_CHUNK_CENSUS_H
#define SCR_CHUNK_CENSUS_H

#define SCR_CHUNKCEN_ON 1

#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>

/* The linkage rule for a header force-included into every TU on this
 * target: shared DATA is selectany with an explicit initialiser, every
 * FUNCTION is static. `weak` is an ELF rule and produces lld-link
 * duplicate-symbol errors across the runtime's ~38 translation units.
 * no_instrument_function so the -finstrument-functions lanes can be
 * combined with this one without the report re-entering itself. */
#define SCR_KC_SHARED __attribute__((selectany))
#define SCR_KC_FN static __attribute__((unused)) __attribute__((no_instrument_function))

/* The page this census counts in. Not queried from the OS: the arithmetic
 * below is about where objects sit inside a 64 KiB chunk, and 4096 is the
 * granularity at which any decommit on this target could act. The `real`
 * ceiling additionally respects the chunk's actual address, so a host with
 * a larger page would make the real number smaller, never larger. */
#define SCR_KC_PAGE ((size_t)4096)

/* Set by whichever walk header compiled; NULL when its owning translation
 * unit was built without the hooks. The distinction is printed, because
 * "this arena has no chunks" and "this arena's walk was never compiled"
 * are different readings and an instrument that cannot separate them will
 * eventually report the second as the first -- the failure tests/perf/
 * u16census records in its armed-control.ts, where a census printed a
 * perfectly well-formed table of nothing because the build had been driven
 * by a CLI whose runtime carried no hook. */
typedef void (*ScrKcWalkFn)(FILE *out, int rows);
SCR_KC_SHARED ScrKcWalkFn scr_kc_cyc_walk = 0;
SCR_KC_SHARED ScrKcWalkFn scr_kc_str_walk = 0;

SCR_KC_SHARED FILE *scr_kc_out = 0;
SCR_KC_SHARED double scr_kc_next_ms = 0;
SCR_KC_SHARED unsigned long long scr_kc_seq = 0;
SCR_KC_SHARED int scr_kc_armed = 0;
SCR_KC_SHARED long scr_kc_ms = -1;
SCR_KC_SHARED int scr_kc_rows = -1;

/* Occupancy buckets: empty, then the 1..9% band split out from the tens,
 * because "160 chunks at 5%" and "160 chunks at 50%" are the two readings
 * this census exists to separate and they must not land in one bucket.
 * Here rather than in either walk because BOTH arenas report against them
 * and a bucket boundary that differed between the two would make the two
 * halves of one report incomparable. */
#define SCR_KC_NBUCKET 12
static const char *const __attribute__((unused)) scr_kc_bucket_name[SCR_KC_NBUCKET] = {
    "0", "1-9", "10-19", "20-29", "30-39", "40-49",
    "50-59", "60-69", "70-79", "80-89", "90-99", "100"};

SCR_KC_FN int scr_kc_bucket(size_t used, size_t cap) {
  size_t pct;
  if (cap == 0 || used == 0) return 0;
  pct = used * 100u / cap;
  if (pct >= 100) return 11;
  if (pct < 10) return 1;
  return (int)(pct / 10) + 1;
}

SCR_KC_FN long scr_kc_envnum(const char *name, long dflt) {
  const char *v = getenv(name);
  if (v == 0 || *v == 0) return dflt;
  return strtol(v, 0, 10);
}

/* Snapshot period in ms; 0 means off. Cached, so the arm cannot change
 * between one window and the next. */
SCR_KC_FN long scr_kc_period(void) {
  if (scr_kc_ms < 0) {
    long v = scr_kc_envnum("SCR_CHUNKCEN_MS", 0);
    scr_kc_ms = v < 0 ? 0 : v;
  }
  return scr_kc_ms;
}

SCR_KC_FN int scr_kc_want_rows(void) {
  if (scr_kc_rows < 0) scr_kc_rows = (int)scr_kc_envnum("SCR_CHUNKCEN_CHUNKS", 1);
  return scr_kc_rows;
}

SCR_KC_FN FILE *scr_kc_stream(void) {
  if (scr_kc_out == 0) {
    const char *p = getenv("SCR_CHUNKCEN_OUT");
    if (p != 0 && *p != 0) scr_kc_out = fopen(p, "w");
    if (scr_kc_out == 0) scr_kc_out = stderr;
    /* The ARMED line exists only if this header was compiled in at all, so
     * a report with no ARMED line is a build that never carried the
     * instrument -- not a run that found nothing. Both walks name
     * themselves as compiled or not, for the same reason. */
    fprintf(scr_kc_out,
            "CHUNKCEN-ARMED v1 chunkBytes=%llu gran=%llu page=%llu "
            "poolGrain=%llu poolMax=%llu cycWalk=%s strWalk=%s\n",
            (unsigned long long)((size_t)64 << 10), (unsigned long long)256,
            (unsigned long long)SCR_KC_PAGE, (unsigned long long)8,
            (unsigned long long)256,
            scr_kc_cyc_walk != 0 ? "compiled" : "ABSENT",
            scr_kc_str_walk != 0 ? "compiled" : "ABSENT");
    fflush(scr_kc_out);
  }
  return scr_kc_out;
}

/* One snapshot. Called from the loop seam with the loop's own clock, and
 * from the exit path with a negative `now` meaning "unconditional". */
SCR_KC_FN void scr_kc_snapshot(double now, const char *why) {
  FILE *f = scr_kc_stream();
  int rows = scr_kc_want_rows();
  scr_kc_seq++;
  fprintf(f, "CHUNKCEN-SNAP %llu ms=%.0f why=%s\n",
          (unsigned long long)scr_kc_seq, now < 0 ? 0.0 : now, why);
  if (scr_kc_cyc_walk != 0) scr_kc_cyc_walk(f, rows);
  else fprintf(f, "CHUNKCEN-CYC WALK-ABSENT\n");
  if (scr_kc_str_walk != 0) scr_kc_str_walk(f, rows);
  else fprintf(f, "CHUNKCEN-STR WALK-ABSENT\n");
  fprintf(f, "CHUNKCEN-END %llu\n", (unsigned long long)scr_kc_seq);
  fflush(f);
}

/* The seam, called from scr_loop_run just after scr_heap_trim. One integer
 * compare when the knob is off, and the pre-instrument runtime otherwise. */
SCR_KC_FN void scr_kc_seam(double now) {
  long win = scr_kc_period();
  if (win == 0) return;
  if (scr_kc_next_ms == 0) { scr_kc_next_ms = now + (double)win; return; }
  if (now < scr_kc_next_ms) return;
  scr_kc_next_ms = now + (double)win;
  scr_kc_snapshot(now, "seam");
}

/* How long the loop may sleep before the next window is due; negative when
 * the knob is off. See the note above about why this cap is load-bearing. */
SCR_KC_FN double scr_kc_due(double now) {
  long win = scr_kc_period();
  if (win == 0) return -1.0;
  if (scr_kc_next_ms == 0) return now + (double)win;
  return scr_kc_next_ms;
}

/* A compiled program's process.exit() lowers to _Exit and skips every
 * atexit handler, so the one exit route a service actually takes would
 * write nothing. Both are registered; the ordering contract for _Exit
 * interposition across the census lanes is in tests/perf/poolstat's header
 * (poolstat first, then prof/cycensus/strcen, then heapcensus, then
 * dyncensus/u16census). This lane chains by name onto whichever of those
 * is present, and is otherwise last. */
SCR_KC_FN void scr_kc_final(void) {
  static int done = 0;
  if (done) return;
  done = 1;
  if (scr_kc_armed) scr_kc_snapshot(-1.0, "exit");
}

/* Run-once across translation units. A constructor is emitted in EVERY TU,
 * and a function-local `static` guard would be per-TU: that is exactly the
 * defect tests/perf/arrcensus records, where the planted rows read
 * n x (TU count) rather than n. The guard is shared data. */
SCR_KC_SHARED int scr_kc_ctor_ran = 0;

__attribute__((constructor)) SCR_KC_FN void scr_kc_arm(void) {
  if (scr_kc_ctor_ran) return;
  scr_kc_ctor_ran = 1;
  scr_kc_armed = 1;
  atexit(scr_kc_final);
}

#endif /* SCR_CHUNK_CENSUS_H */
