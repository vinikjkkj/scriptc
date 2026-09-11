/* THE RESERVATION COUNTERS, AND NOTHING ELSE.
 *
 * WHY THIS EXISTS AS ITS OWN HEADER rather than riding the heap census. The
 * A/B for SCR_CYCLE_ARENA_VM is read in private working set, so the binary it
 * is measured on has to stay as close to shipping as the question allows.
 * tests/perf/heapcensus/scr_heap_census.h would also deliver these counters --
 * scr_cycle.c is chained from its _Exit path for exactly that reason -- but it
 * walks every heap and holds an arm of its own allocations to do it, and that
 * perturbs the column the A/B is denominated in. This header adds one call at
 * exit and allocates nothing.
 *
 * WHY IT IS NEEDED AT ALL. process.exit() lowers to _Exit in these binaries,
 * which skips every atexit handler, so the arm scr_cyc_pr_arm installs is
 * silently dead in exactly the executable the measurement is taken on. Without
 * an _Exit interposition the counters do not merely go missing -- the run looks
 * like a clean run of an instrument that found nothing.
 *
 * WHAT IT IS FOR, and it is not decoration. Two arms of one binary reporting
 * the same settled working set is NOT evidence that the reservation arm ran. A
 * knob that never reached the child prints the same figure. These counters are
 * the only thing that can distinguish "measured and drew" from "measured
 * nothing twice", and the vm=0 arm is the control that proves they can read
 * zero and say why.
 *
 * MUTUALLY EXCLUSIVE WITH THE HEAP CENSUS BY CONSTRUCTION: both interpose
 * _Exit, and that header raises #error rather than chaining silently if
 * something got there first. Use one or the other, never both -- the census
 * build already calls scr_cyc_arenavm_report itself under
 * -DSCR_CYC_ARENAVM_ON=1, so pairing them would be a duplicate report as well
 * as a build failure.
 *
 * Build:  SCRIPTC_PROF_CFLAGS="-include <this>"   plus SCRIPTC_NO_CACHE=1,
 * because a -included header under tests/perf is not in the build cache key
 * and an uninstrumented binary would be served from it byte-identical.
 */
#ifndef SCR_ARENAVM_STAT_H
#define SCR_ARENAVM_STAT_H

#include <stdlib.h>

/* Defined non-static in packages/runtime/src/scr_cycle.c, in BOTH arms of
 * SCR_CYC_ARENA_VM, so that linking never depends on which way the feature was
 * compiled. It is idempotent: reached twice costs a duplicate line rather than
 * doubled counters. */
extern void scr_cyc_arenavm_report(void);

#if defined(_Exit)
#error "another header already interposes _Exit; chain scr_cyc_arenavm_report there explicitly"
#else
#define _Exit(c) (scr_cyc_arenavm_report(), _Exit(c))
#endif

/* The ordinary exit path too, for a harness that does not go through _Exit --
 * a binary that returns from main, or a test driver. Idempotence is what makes
 * having both safe. */
/* SHARED, not a function-local static: this header is -included into every
 * translation unit, so the constructor is emitted ~70 times and a per-TU flag
 * would register ~70 atexit handlers. scr_heap_census.h hit this exact defect
 * and its note records what it cost -- the constructor claimed the flag, the
 * arm early-returned, and the report was silently skipped. */
__attribute__((selectany)) int scr_arenavm_installed = 0;
__attribute__((constructor)) static void scr_arenavm_install(void) {
  if (scr_arenavm_installed) return;
  scr_arenavm_installed = 1;
  atexit(scr_cyc_arenavm_report);
}

#endif /* SCR_ARENAVM_STAT_H */
