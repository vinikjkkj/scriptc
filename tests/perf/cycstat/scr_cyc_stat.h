/* scr_cyc_stat.h - what the cycle collector actually costs, in cycles.
 *
 * The frequency knobs (SCR_CYCLE_THRESHOLD, SCR_CYCLE_IDLE_PACE) answer the
 * question DIFFERENTIALLY: turn passes off, see what the bench does. That is
 * the right instrument for "does this change pay", and it is the wrong one
 * for "how much is left", because a differential inside the A/A floor cannot
 * tell a small cost from no cost at all. This one is absolute: it reads the
 * TSC around every pass and around each of the four phases inside it, and
 * prints the totals at exit.
 *
 * Injected the way tests/perf/cycensus's header is: force-included through
 * SCRIPTC_PROF_CFLAGS with -DSCR_CYCSTAT_ON, so scr_cycle.c's hooks compile
 * and every other build carries no trace of it. It follows the linkage rules
 * scr_prof.h established for this target -- shared DATA is selectany with an
 * explicit initialiser, every FUNCTION is static -- because it is included
 * into every translation unit and only scr_cycle.c calls it.
 *
 * IT REFUSES TO REPORT A SILENT ZERO. A pass counter that reads 0 has two
 * causes -- the collector never ran, or the hooks were never compiled -- and
 * an instrument that cannot tell them apart will eventually report the
 * second as the first. So the report prints an explicit ARMED line (which
 * only exists if this header was compiled in at all) and, when the pass
 * count is zero, says NO PASSES rather than printing zeros that read like
 * measurements. The positive control is SCR_CYCLE_IDLE_PACE=0: that arm runs
 * an unconditional pass at every loop quiescence, so it MUST report
 * thousands of passes and a cycle total that reconciles with the
 * pace-0-vs-64 differential on the same binary. An arm that reports nothing
 * under that setting is a broken instrument, not a cheap collector.
 *
 * SCR_CYCSTAT_OUT names a file; absent, the report goes to stderr.
 */
#ifndef SCR_CYC_STAT_H
#define SCR_CYC_STAT_H

#ifdef SCR_CYCSTAT_ON

#include <stdio.h>
#include <stdlib.h>

#define SCR_CS_SHARED __attribute__((selectany))
#define SCR_CS_FN static __attribute__((unused))

SCR_CS_SHARED unsigned long long scr_cs_passes = 0;
SCR_CS_SHARED unsigned long long scr_cs_roots = 0;   /* purple roots marked */
SCR_CS_SHARED unsigned long long scr_cs_freed = 0;   /* white objects torn down */
SCR_CS_SHARED unsigned long long scr_cs_tot = 0;     /* TSC in scr_collect_cycles */
SCR_CS_SHARED unsigned long long scr_cs_mark = 0;    /* ... in markRoots/markGray */
SCR_CS_SHARED unsigned long long scr_cs_scan = 0;    /* ... in scan/scanBlack */
SCR_CS_SHARED unsigned long long scr_cs_white = 0;   /* ... in collectWhite */
SCR_CS_SHARED unsigned long long scr_cs_free = 0;    /* ... in the teardowns */
SCR_CS_SHARED unsigned long long scr_cs_t0 = 0;
SCR_CS_SHARED unsigned long long scr_cs_p0 = 0;
SCR_CS_SHARED int scr_cs_registered = 0;

SCR_CS_FN unsigned long long scr_cs_now(void) { return __builtin_ia32_rdtsc(); }

SCR_CS_FN void scr_cs_report(void) {
  FILE *f = stderr;
  const char *out = getenv("SCR_CYCSTAT_OUT");
  if (out != NULL && *out != '\0') {
    FILE *g = fopen(out, "w");
    if (g != NULL) f = g;
  }
  /* ARMED is printed unconditionally: it is the only line that proves the
   * hooks were compiled in, and it is what makes a zero below readable. */
  fprintf(f, "[cycstat] ARMED tests/perf/cycstat/scr_cyc_stat.h\n");
  if (scr_cs_passes == 0) {
    fprintf(f, "[cycstat] NO PASSES - the collector never ran in this process."
               " That is a measurement only if the arm was meant to suppress"
               " it; under SCR_CYCLE_IDLE_PACE=0 it is a broken instrument.\n");
  }
  fprintf(f, "[cycstat] passes=%llu roots=%llu freed=%llu\n",
          scr_cs_passes, scr_cs_roots, scr_cs_freed);
  fprintf(f, "[cycstat] Mcycles total=%.1f mark=%.1f scan=%.1f white=%.1f"
             " teardown=%.1f\n",
          (double)scr_cs_tot / 1e6, (double)scr_cs_mark / 1e6,
          (double)scr_cs_scan / 1e6, (double)scr_cs_white / 1e6,
          (double)scr_cs_free / 1e6);
  if (f != stderr) fclose(f);
}

SCR_CS_FN void scr_cs_pass_begin(void) {
  if (!scr_cs_registered) {
    scr_cs_registered = 1;
    atexit(scr_cs_report);
  }
  scr_cs_passes++;
  scr_cs_t0 = scr_cs_now();
}
SCR_CS_FN void scr_cs_pass_end(void) { scr_cs_tot += scr_cs_now() - scr_cs_t0; }
SCR_CS_FN void scr_cs_phase_begin(void) { scr_cs_p0 = scr_cs_now(); }
SCR_CS_FN void scr_cs_phase_end(unsigned long long *acc) {
  *acc += scr_cs_now() - scr_cs_p0;
}

#define SCR_CS_PASS_BEGIN() scr_cs_pass_begin()
#define SCR_CS_PASS_END() scr_cs_pass_end()
#define SCR_CS_PHASE_BEGIN() scr_cs_phase_begin()
#define SCR_CS_PHASE_END(which) scr_cs_phase_end(&scr_cs_##which)
#define SCR_CS_ADD(which, n) (scr_cs_##which += (unsigned long long)(n))

#else /* not armed: every hook is nothing at all */

#define SCR_CS_PASS_BEGIN() ((void)0)
#define SCR_CS_PASS_END() ((void)0)
#define SCR_CS_PHASE_BEGIN() ((void)0)
#define SCR_CS_PHASE_END(which) ((void)0)
#define SCR_CS_ADD(which, n) ((void)0)

#endif /* SCR_CYCSTAT_ON */
#endif /* SCR_CYC_STAT_H */
