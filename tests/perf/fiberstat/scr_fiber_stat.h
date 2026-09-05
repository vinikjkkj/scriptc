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
  if (scr_fst_reported) return;
  scr_fst_reported = 1;
  path = getenv("SCR_FIBERSTAT_OUT");
  if (path == NULL || path[0] == 0) return;
  f = fopen(path, "wb");
  if (f == NULL) return;
  scr_fst_line(line, (int)sizeof line);
  fputs("[fiberstat] ", f);
  fputs(line, f);
  fputc('\n', f);
  fclose(f);
}

SCR_FST_FN void scr_fst_arm(void) {
  if (scr_fst_armed) return; /* one constructor per TU; 21 in a zapo build */
  scr_fst_armed = 1;
  atexit(scr_fst_report);
}
__attribute__((constructor)) SCR_FST_FN void scr_fst_ctor(void) { scr_fst_arm(); }

#endif /* SCR_FIBER_STAT_H */
