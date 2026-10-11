/* scr_fiber_stat.h - GAUGES FOR THE FIBER STACK POPULATION.
 *
 * The question this exists for: at the instant peak RSS is made, how many
 * win32 fiber stacks exist, and how many of them are IDLE POOLED ones
 * rather than stacks a live task is sitting on? scr_memmap.h can say that
 * the STACK class holds N MiB of resident pages and can count the regions,
 * but a region cannot say whether the task that owns it is running,
 * suspended, or finished-and-recycled. Only the runtime knows that, and
 * scr_async.c's counters are `static`.
 *
 * SHAPE. Exactly the contract tests/perf/cycstat/scr_cyc_stat.h uses: this
 * header owns the storage, scr_async.c carries `#ifndef SCR_FST_* -> no-op`
 * macro calls, and with this header absent every one of them preprocesses
 * to `((void)0)`. An uninstrumented build carries no instruction of it.
 *
 * WHAT IS COUNTED, and each is a COUNTER, never a sample:
 *
 *   out      stacks acquired minus stacks released: a task is running or
 *            suspended on each one. This is "concurrency" in the only
 *            sense that costs memory.
 *   pool     idle stacks on scr_stack_pool. Touched pages, no task.
 *   fresh    CreateFiberEx calls: stacks that did not come from the pool.
 *   freed    DeleteFiber calls: stacks the pool would not take back.
 *
 * `out` and `pool` each carry a HIGH-WATER companion, updated on the way
 * up only, so the maximum is exact and not a sampling artifact.
 *
 * ARMING, because a gauge that can only read zero passes every workload.
 * -DSCR_FST_ARM=N is not available here (a stack cannot be planted from a
 * constructor without running the loop), so the POSITIVE CONTROL is an A/B
 * on a knob the runtime already ships: SCR_FIBER_POOL=0 must drive `pool`
 * and `poolHi` to 0 and `fresh` to at least `out_hi`, while the default cap
 * must show poolHi > 0. A build where both settings read the same is a
 * broken instrument, not a well-behaved pool. scr_fst_report writes both
 * numbers, so the control is one line of diff.
 *
 * USE
 *   SCRIPTC_PROF_CFLAGS="-include <repo>/tests/perf/fiberstat/scr_fiber_stat.h"
 *   SCR_FIBERSTAT_OUT=<file>   where the report is written at exit
 * and, if scr_memmap.h is also -include'd (AFTER this one), the same
 * gauges are printed inside every memmap snapshot, which is the only way
 * to read them AT THE PEAK rather than at exit.
 */
#ifndef SCR_FIBER_STAT_H
#define SCR_FIBER_STAT_H

#define SCR_FIBERSTAT_ON 1

#include <stdio.h>
#include <stdlib.h>

/* selectany + static functions: the linkage rule scr_prof.h established for
 * x86_64-windows-gnu. `weak` is an ELF rule and duplicates hard-error here. */
#define SCR_FST_SHARED __attribute__((selectany))
#define SCR_FST_FN static __attribute__((unused)) __attribute__((no_instrument_function))

enum {
  SCR_FST_OUT = 0,
  SCR_FST_OUT_HI,
  SCR_FST_POOL,
  SCR_FST_POOL_HI,
  SCR_FST_FRESH,
  SCR_FST_FREED,
  SCR_FST_N
};

SCR_FST_SHARED unsigned long long scr_fst_c[SCR_FST_N] = {0, 0, 0, 0, 0, 0};
SCR_FST_SHARED int scr_fst_reported = 0;
/* selectany, not a function-local static: a function-local static gets one
 * copy PER TU (the code is static, only the data is merged), so an "armed"
 * flag kept there would arm 21 times and prove nothing. */
SCR_FST_SHARED int scr_fst_armed = 0;
SCR_FST_SHARED const char *scr_fst_via = "ctor";

/* The four hooks scr_async.c calls. Each is a single add on a path that
 * already either pops a list or calls into kernel32. */
#define SCR_FST_ACQUIRE()                                                    \
  do {                                                                       \
    scr_fst_c[SCR_FST_OUT]++;                                                \
    if (scr_fst_c[SCR_FST_OUT] > scr_fst_c[SCR_FST_OUT_HI])                  \
      scr_fst_c[SCR_FST_OUT_HI] = scr_fst_c[SCR_FST_OUT];                    \
  } while (0)
#define SCR_FST_RELEASE()                                                    \
  do {                                                                       \
    if (scr_fst_c[SCR_FST_OUT]) scr_fst_c[SCR_FST_OUT]--;                    \
  } while (0)
#define SCR_FST_POOLED(n)                                                    \
  do {                                                                       \
    scr_fst_c[SCR_FST_POOL] = (unsigned long long)(n);                       \
    if (scr_fst_c[SCR_FST_POOL] > scr_fst_c[SCR_FST_POOL_HI])                \
      scr_fst_c[SCR_FST_POOL_HI] = scr_fst_c[SCR_FST_POOL];                  \
  } while (0)
#define SCR_FST_FRESH_ONE() (scr_fst_c[SCR_FST_FRESH]++)
#define SCR_FST_FREED_ONE() (scr_fst_c[SCR_FST_FREED]++)

/* == E2: PER-ENTRY PARK ATTRIBUTION ====================================
 *
 * The counters above answer "how many stacks are OUT" for the process as a
 * whole. The question this block exists for is narrower, and it is the one a
 * conversion decision actually rests on: for ONE named async entry, how many
 * of its frames are SUSPENDED AT THE SAME INSTANT?
 *
 * Why `out` cannot answer it. (a) `out` is per-process and scr_stack_acquire
 * is called from scr_gen_new as well as scr_async_spawn, so a generator
 * population is mixed into the async one. (b) `out` counts a stack from
 * acquire to release, and scr_async_spawn runs a body EAGERLY to its first
 * suspension -- a body that never suspends is acquired and released inside
 * the spawn call, so it raises `out` by one without ever costing two stacks
 * at once. Counting spawns, or counting `out`, is exactly the error that let
 * 194 converted spawn sites buy 0.01 MiB: a spawn that completes inside one
 * turn has no concurrency at all.
 *
 * So this table is keyed on the fiber ENTRY POINTER (ScrFiber.entry, which
 * both spawn paths already store) and counts the suspension itself:
 *
 *   spawns    scr_async_spawn / scr_gen_new calls carrying this entry
 *   kind      async | gen
 *   parkIn    scr_await_park calls -- an await on an UNSETTLED promise
 *   parkLive  parked right now;  parkHi its exact high-water
 *   yieldIn   scr_await_yield calls -- the one-turn microtask hop an await
 *             of an ALREADY-SETTLED promise takes. Suspended too, and still
 *             holding its stack, so it is counted beside parks rather than
 *             folded in: a shape that only hops is cheap in a way a shape
 *             that waits on I/O is not.
 *   yieldLive / yieldHi
 *
 * BIAS, stated because it is one-sided: a fiber torn down while parked never
 * runs its _OUT, so parkLive can only drift UP. Every number here is an
 * upper bound on the true concurrency. A zero is therefore a hard zero.
 *
 * NAMES. The emitted entries are `define internal` on the LLVM lane, so they
 * cannot be declared here and the table reports POINTERS; `base` is the
 * module handle so an address reduces to an RVA. Attribution for this slice
 * is done by workload instead: at main there are exactly two
 * scr_async_spawn entries left in the zapo-rest artifact, and only one of
 * them can run while no session is being destroyed.
 *
 * READOUT WITHOUT atexit. zapo-rest ends in process.exit(), which lowers to
 * _Exit and skips every atexit handler, so an instrument that only arms
 * atexit is silently never written. Four independent paths write this one
 * and the file names which did: the constructor (so a file of zeroes proves
 * the instrument LOADED and read nothing, which a missing file does not),
 * every new global suspension high-water, the _Exit interposer below (the
 * contract scr_cyc_stat.h established), and atexit.
 */

#define SCR_FST_PARK_ON 1
#define SCR_FST_SLOTS 64
enum {
  SCR_FSTE_SPAWNS = 0,
  SCR_FSTE_KIND,
  SCR_FSTE_PARK_IN,
  SCR_FSTE_PARK_LIVE,
  SCR_FSTE_PARK_HI,
  SCR_FSTE_YIELD_IN,
  SCR_FSTE_YIELD_LIVE,
  SCR_FSTE_YIELD_HI,
  SCR_FSTE_N
};

SCR_FST_SHARED const void *scr_fst_key[SCR_FST_SLOTS];
SCR_FST_SHARED unsigned long long scr_fst_tab[SCR_FST_SLOTS][SCR_FSTE_N];
SCR_FST_SHARED unsigned long long scr_fst_keys_n = 0;
SCR_FST_SHARED unsigned long long scr_fst_overflow = 0;
/* the process-wide suspended population, both flavours together */
SCR_FST_SHARED unsigned long long scr_fst_susp = 0;
SCR_FST_SHARED unsigned long long scr_fst_susp_hi = 0;

SCR_FST_FN void scr_fst_report(void);

SCR_FST_FN int scr_fst_slot(const void *e) {
  unsigned long long h = (unsigned long long)(size_t)e;
  int i;
  int probe = 0;
  h = (h >> 4) ^ (h >> 17);
  i = (int)(h & (unsigned long long)(SCR_FST_SLOTS - 1));
  while (probe < SCR_FST_SLOTS) {
    if (scr_fst_key[i] == e) return i;
    if (scr_fst_key[i] == 0) {
      scr_fst_key[i] = e;
      scr_fst_keys_n++;
      return i;
    }
    i = (i + 1) & (SCR_FST_SLOTS - 1);
    probe++;
  }
  scr_fst_overflow++;
  return -1;
}

#define SCR_FST_SPAWN(e, k)                                                  \
  do {                                                                       \
    int si_ = scr_fst_slot((const void *)(e));                               \
    if (si_ >= 0) {                                                          \
      scr_fst_tab[si_][SCR_FSTE_SPAWNS]++;                                   \
      scr_fst_tab[si_][SCR_FSTE_KIND] = (unsigned long long)(k);             \
    }                                                                        \
  } while (0)

#define SCR_FST_SUSP_UP()                                                    \
  do {                                                                       \
    scr_fst_susp++;                                                          \
    if (scr_fst_susp > scr_fst_susp_hi) {                                    \
      scr_fst_susp_hi = scr_fst_susp;                                        \
      scr_fst_reported = 0;                                                  \
      scr_fst_via = "high-water";                                            \
      scr_fst_report();                                                      \
    }                                                                        \
  } while (0)
#define SCR_FST_SUSP_DOWN()                                                  \
  do {                                                                       \
    if (scr_fst_susp) scr_fst_susp--;                                        \
  } while (0)

#define SCR_FST_PARK_IN(e)                                                   \
  do {                                                                       \
    int si_ = scr_fst_slot((const void *)(e));                               \
    if (si_ >= 0) {                                                          \
      scr_fst_tab[si_][SCR_FSTE_PARK_IN]++;                                  \
      scr_fst_tab[si_][SCR_FSTE_PARK_LIVE]++;                                \
      if (scr_fst_tab[si_][SCR_FSTE_PARK_LIVE] >                             \
          scr_fst_tab[si_][SCR_FSTE_PARK_HI])                                \
        scr_fst_tab[si_][SCR_FSTE_PARK_HI] =                                 \
            scr_fst_tab[si_][SCR_FSTE_PARK_LIVE];                            \
    }                                                                        \
    SCR_FST_SUSP_UP();                                                       \
  } while (0)
#define SCR_FST_PARK_OUT(e)                                                  \
  do {                                                                       \
    int si_ = scr_fst_slot((const void *)(e));                               \
    if (si_ >= 0 && scr_fst_tab[si_][SCR_FSTE_PARK_LIVE])                    \
      scr_fst_tab[si_][SCR_FSTE_PARK_LIVE]--;                                \
    SCR_FST_SUSP_DOWN();                                                     \
  } while (0)

#define SCR_FST_YIELD_IN(e)                                                  \
  do {                                                                       \
    int si_ = scr_fst_slot((const void *)(e));                               \
    if (si_ >= 0) {                                                          \
      scr_fst_tab[si_][SCR_FSTE_YIELD_IN]++;                                 \
      scr_fst_tab[si_][SCR_FSTE_YIELD_LIVE]++;                               \
      if (scr_fst_tab[si_][SCR_FSTE_YIELD_LIVE] >                            \
          scr_fst_tab[si_][SCR_FSTE_YIELD_HI])                               \
        scr_fst_tab[si_][SCR_FSTE_YIELD_HI] =                                \
            scr_fst_tab[si_][SCR_FSTE_YIELD_LIVE];                           \
    }                                                                        \
    SCR_FST_SUSP_UP();                                                       \
  } while (0)
#define SCR_FST_YIELD_OUT(e)                                                 \
  do {                                                                       \
    int si_ = scr_fst_slot((const void *)(e));                               \
    if (si_ >= 0 && scr_fst_tab[si_][SCR_FSTE_YIELD_LIVE])                   \
      scr_fst_tab[si_][SCR_FSTE_YIELD_LIVE]--;                               \
    SCR_FST_SUSP_DOWN();                                                     \
  } while (0)

/* The module base, so a table address reduces to an RVA.
 *
 * NOT via <windows.h>: this header is -include'd into EVERY runtime TU, and
 * scr_fetch_dispatch.c includes winsock2.h, which must precede winsock.h.
 * Pulling windows.h in first redefines fd_set and the build dies with 20
 * errors in a file that has nothing to do with fibers -- measured, on the
 * first app182 link of this slice. __ImageBase is the PE image start,
 * supplied by the linker, and needs no header at all. */
#ifdef _WIN32
extern char __ImageBase[];
SCR_FST_FN void *scr_fst_module_base(void) { return (void *)__ImageBase; }
#else
SCR_FST_FN void *scr_fst_module_base(void) { return (void *)0; }
#endif

SCR_FST_FN void scr_fst_line(char *b, int cap) {
  /* snprintf is fine here: this runs at exit or from a phase edge, never on
   * a hot path, and the memmap lane formats its own copy by hand. */
  snprintf(b, (size_t)cap,
           "out=%llu outHi=%llu pool=%llu poolHi=%llu fresh=%llu freed=%llu",
           scr_fst_c[SCR_FST_OUT], scr_fst_c[SCR_FST_OUT_HI], scr_fst_c[SCR_FST_POOL],
           scr_fst_c[SCR_FST_POOL_HI], scr_fst_c[SCR_FST_FRESH], scr_fst_c[SCR_FST_FREED]);
}

SCR_FST_FN void scr_fst_report(void) {
  const char *path;
  FILE *f;
  char line[256];
  int i;
  if (scr_fst_reported) return;
  scr_fst_reported = 1;
  path = getenv("SCR_FIBERSTAT_OUT");
  if (path == NULL || path[0] == 0) return;
  /* "wb", not append: the file is REWRITTEN on every new high-water, so the
   * last write always carries the whole truth and a reader never stitches. */
  f = fopen(path, "wb");
  if (f == NULL) return;
  scr_fst_line(line, (int)sizeof line);
  fputs("[fiberstat] ", f);
  fputs(line, f);
  fprintf(f, " via=%s susp=%llu suspHi=%llu entries=%llu overflow=%llu\n",
          scr_fst_via, scr_fst_susp, scr_fst_susp_hi, scr_fst_keys_n,
          scr_fst_overflow);
  fprintf(f, "[parktable] base=%p\n", scr_fst_module_base());
  fputs("entry\tkind\tspawns\tparkIn\tparkLive\tparkHi\tyieldIn\tyieldLive\tyieldHi\n", f);
  for (i = 0; i < SCR_FST_SLOTS; i++) {
    if (scr_fst_key[i] == 0) continue;
    fprintf(f, "%p\t%s\t%llu\t%llu\t%llu\t%llu\t%llu\t%llu\t%llu\n",
            scr_fst_key[i], scr_fst_tab[i][SCR_FSTE_KIND] ? "gen" : "async",
            scr_fst_tab[i][SCR_FSTE_SPAWNS], scr_fst_tab[i][SCR_FSTE_PARK_IN],
            scr_fst_tab[i][SCR_FSTE_PARK_LIVE], scr_fst_tab[i][SCR_FSTE_PARK_HI],
            scr_fst_tab[i][SCR_FSTE_YIELD_IN],
            scr_fst_tab[i][SCR_FSTE_YIELD_LIVE],
            scr_fst_tab[i][SCR_FSTE_YIELD_HI]);
  }
  fclose(f);
}

/* The contract scr_cyc_stat.h established. zapo-rest's exit route ends in
 * process.exit(), which lowers to _Exit (scr_lib.c) and skips atexit, so an
 * atexit registration on its own leaves this instrument silently blank.
 * scr_lib.c is a runtime TU and therefore sees this -include. */
SCR_FST_FN void scr_fst_report_exit(void) {
  scr_fst_via = "_Exit";
  scr_fst_reported = 0;
  scr_fst_report();
}
#ifdef _Exit
#undef _Exit
#endif
#define _Exit(c) (scr_fst_report_exit(), _Exit(c))

SCR_FST_FN void scr_fst_report_atexit(void) {
  scr_fst_via = "atexit";
  scr_fst_reported = 0;
  scr_fst_report();
}

SCR_FST_FN void scr_fst_arm(void) {
  if (scr_fst_armed) return; /* one constructor per TU; 21 in a zapo build */
  scr_fst_armed = 1;
  atexit(scr_fst_report_atexit);
  /* A zeroed report written HERE is the liveness proof: a reader that finds
   * no file at all learns the instrument never loaded, which is a different
   * fact from "it loaded and counted nothing". */
  scr_fst_via = "ctor";
  scr_fst_report();
  scr_fst_reported = 0;
}
__attribute__((constructor)) SCR_FST_FN void scr_fst_ctor(void) { scr_fst_arm(); }

#endif /* SCR_FIBER_STAT_H */
