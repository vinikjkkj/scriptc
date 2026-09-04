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
/* The arena, counted where the residency profiler cannot see it. A carve is
 * invisible to any malloc interposer (no malloc happens), and the OVERFLOW
 * path -- a block the pool's byte budget refused, which must go on the
 * arena's own list and never to free() -- is not reached on zapo at all,
 * because that budget is never reached. Rebuild with
 * -DSCR_POOL_DEPTH=1 -DSCR_POOL_BUDGET=0 to force it and read `argive` here:
 * a zero there under a starved pool means the branch did not run, which is
 * the one thing a passing test cannot tell you. */
SCR_CS_SHARED unsigned long long scr_cs_archunk = 0; /* 64 KiB chunks taken */
SCR_CS_SHARED unsigned long long scr_cs_arcarve = 0; /* blocks bump-carved */
SCR_CS_SHARED unsigned long long scr_cs_arhit = 0;   /* popped off an arena list */
SCR_CS_SHARED unsigned long long scr_cs_argive = 0;  /* pushed onto one */
SCR_CS_SHARED unsigned long long scr_cs_arcalloc = 0; /* fell back to calloc */
/* The STRING arena, the same five questions about scr_string.c's own carve.
 * It needs its own counters and not a shared set: the two arenas serve
 * different class ranges out of different chunks, and a single `carved`
 * column could never say which of them a change moved. `sarmalloc` is the
 * fallback, and a non-zero there means a block was allocated OUTSIDE the
 * arena at a size the release path will hand to the arena's free list --
 * safe, but no longer free()able, which is the one thing about the cap
 * predicate worth counting. */
SCR_CS_SHARED unsigned long long scr_cs_sarchunk = 0;  /* 64 KiB chunks taken */
SCR_CS_SHARED unsigned long long scr_cs_sarcarve = 0;  /* blocks bump-carved */
SCR_CS_SHARED unsigned long long scr_cs_sarhit = 0;    /* popped off a list */
SCR_CS_SHARED unsigned long long scr_cs_sargive = 0;   /* pushed onto one */
SCR_CS_SHARED unsigned long long scr_cs_sarmalloc = 0; /* fell back to malloc */
/* The content-intern cache in scr_string.c. A HIT is an allocation that did
 * not happen; a PUT is one that did and was cached; an EVICT is a resident
 * entry the table let go of. hit/(hit+put) is the hit rate, and a run with
 * put > 0 and hit == 0 is a cache that is only ever paying. */
SCR_CS_SHARED unsigned long long scr_cs_sihit = 0;
SCR_CS_SHARED unsigned long long scr_cs_siput = 0;
SCR_CS_SHARED unsigned long long scr_cs_sievict = 0;
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
  fprintf(f, "[cycstat] arena chunks=%llu carved=%llu listhit=%llu"
             " listgive=%llu callocfallback=%llu\n",
          scr_cs_archunk, scr_cs_arcarve, scr_cs_arhit, scr_cs_argive,
          scr_cs_arcalloc);
  if (scr_cs_arcarve == 0) {
    fprintf(f, "[cycstat] ARENA NEVER CARVED - either SCR_CYCLE_ARENA=0 or the"
               " arena is not reached. Not a measurement of the arena.\n");
  }
  fprintf(f, "[cycstat] strarena chunks=%llu carved=%llu listhit=%llu"
             " listgive=%llu mallocfallback=%llu\n",
          scr_cs_sarchunk, scr_cs_sarcarve, scr_cs_sarhit, scr_cs_sargive,
          scr_cs_sarmalloc);
  fprintf(f, "[cycstat] strintern hit=%llu put=%llu evict=%llu hitRate=%.4f\n",
          scr_cs_sihit, scr_cs_siput, scr_cs_sievict,
          (scr_cs_sihit + scr_cs_siput) > 0
              ? (double)scr_cs_sihit / (double)(scr_cs_sihit + scr_cs_siput)
              : 0.0);
  if (scr_cs_sihit == 0 && scr_cs_siput == 0) {
    fprintf(f, "[cycstat] STRING INTERN NEVER PROBED - either"
               " SCR_STRING_INTERN=0, or SCR_RC_AUDIT compiled it out, or no"
               " concat result in this program is inside the length band."
               " Not a measurement of interning.\n");
  }
  if (scr_cs_sarcarve == 0) {
    fprintf(f, "[cycstat] STRING ARENA NEVER CARVED - either"
               " SCR_STRING_ARENA=0, or SCR_RC_AUDIT compiled it out, or no"
               " heap string in this program is small enough to reach it."
               " Not a measurement of the string arena.\n");
  }
  if (f != stderr) fclose(f);
}

/* The report is registered by whichever hook fires first. The cycle
 * collector's pass hook cannot be the only one: a program that allocates
 * strings and never collects a cycle would report nothing at all, and an
 * empty report is exactly the shape this header exists to refuse. */
SCR_CS_FN void scr_cs_arm(void) {
  if (!scr_cs_registered) {
    scr_cs_registered = 1;
    atexit(scr_cs_report);
  }
}

SCR_CS_FN void scr_cs_pass_begin(void) {
  scr_cs_arm();
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
#define SCR_CS_BUMP(which) (scr_cs_##which += 1u)
#define SCR_CS_ARM() scr_cs_arm()

#else /* not armed: every hook is nothing at all */

#define SCR_CS_PASS_BEGIN() ((void)0)
#define SCR_CS_PASS_END() ((void)0)
#define SCR_CS_PHASE_BEGIN() ((void)0)
#define SCR_CS_PHASE_END(which) ((void)0)
#define SCR_CS_ADD(which, n) ((void)0)
#define SCR_CS_BUMP(which) ((void)0)
#define SCR_CS_ARM() ((void)0)

#endif /* SCR_CYCSTAT_ON */
#endif /* SCR_CYC_STAT_H */
