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
/* Chunks GIVEN BACK, which is the one number the old arena could never
 * report anything but zero for. Read it against `archunk`: chunks - arfree
 * is what the process still holds, and on a workload whose small-object
 * population spikes and then settles that difference is the retention the
 * heap census sees as 65,536-byte busy blocks. A zero here with a non-zero
 * archunk is not "nothing emptied" unless the live set says so - check
 * cycensus's live bytes before reading it that way. */
SCR_CS_SHARED unsigned long long scr_cs_arfree = 0;  /* chunks released */
/* The HIGH-WATER of chunks held at once, which is the only one of these
 * four that bounds the retention: chunks-freed says reclamation happened,
 * chunks-held-at-exit says what is left, and neither says what the process
 * asked the OS for while it was busy. */
SCR_CS_SHARED unsigned long long scr_cs_arpeak = 0;
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
/* THE CHUNK RECLAMATION TRIO, and it is three counters rather than one for a
 * reason this project has now paid for twice in one day.
 *
 * "chunks returned = 0" has three causes that look identical from outside,
 * and the byte delta is the same for all of them:
 *
 *   chunkgive == 0    the accounting never ran. INERT CODE.
 *   chunkgive  > 0
 *   chunkfree == 0    the accounting ran and no chunk ever emptied. That is
 *                     the PLACEMENT problem, not a bug -- the cycle arena
 *                     holds 13.63 MiB in exactly this state.
 *   chunkforeign      gives whose block belonged to NO chunk. Real and
 *                     expected: scr_str_ar_give is a sink for blocks the
 *                     malloc fallback produced, which were never carved. A
 *                     `used` scheme that decremented for one of these would
 *                     free a chunk somebody is still handing out.
 *
 * A sibling shipped page-return code whose every call the OS refused, and it
 * reported zero pages returned with no error; it surfaced only because a
 * `failed` counter separated a refused call from an absent one. This is that
 * shape, for this arena. */
SCR_CS_SHARED unsigned long long scr_cs_sarchunkgive = 0;    /* gives charged to a chunk */
SCR_CS_SHARED unsigned long long scr_cs_sarchunkfree = 0;    /* chunks free()d at used==0 */
SCR_CS_SHARED unsigned long long scr_cs_sarchunkforeign = 0; /* gives owned by no chunk */
/* The content-intern cache in scr_string.c. A HIT is an allocation that did
 * not happen; a MISS is a probe that found nothing; a PUT is an allocation
 * that happened and was cached; an EVICT is a resident entry the table let
 * go of; a REFUSE is a miss the table declined to cache because every way of
 * its set was still referenced by the program.
 *
 * EVICT AND REFUSE ARE THE INSTRUMENT, not decoration. The table is
 * set-associative precisely because the direct-mapped one thrashed -- and
 * "it no longer thrashes" is a claim a hit rate cannot make, because a hit
 * rate stays high while two hot contents beat each other out of one slot as
 * long as everything ELSE hits. evict/put is what moves: a well-behaved
 * table evicts only dead weight (rc == 1 entries) and evicts rarely.
 *
 * THE POSITIVE CONTROL IS SCR_STRING_INTERN_WAYS=1, which is the
 * direct-mapped table in the same image. On that arm evict/put MUST be
 * large; on the default arm it must be small. A build where both read small
 * has not measured a good cache -- it has failed to compile the hooks, or
 * never reached the length band, and the report below says so by name
 * rather than printing a zero that reads like a result. */
SCR_CS_SHARED unsigned long long scr_cs_sihit = 0;
SCR_CS_SHARED unsigned long long scr_cs_simiss = 0;
SCR_CS_SHARED unsigned long long scr_cs_siput = 0;
SCR_CS_SHARED unsigned long long scr_cs_sievict = 0;
SCR_CS_SHARED unsigned long long scr_cs_sirefuse = 0;
SCR_CS_SHARED unsigned long long scr_cs_t0 = 0;
SCR_CS_SHARED unsigned long long scr_cs_p0 = 0;
SCR_CS_SHARED int scr_cs_registered = 0;
SCR_CS_SHARED int scr_cs_reported = 0;

SCR_CS_FN unsigned long long scr_cs_now(void) { return __builtin_ia32_rdtsc(); }

SCR_CS_FN void scr_cs_report(void) {
  /* Idempotent: the atexit registration and the _Exit interposer can both
   * fire, and two reports in one file is a corrupt measurement. */
  if (scr_cs_reported) return;
  scr_cs_reported = 1;
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
  fprintf(f, "[cycstat] arena chunks=%llu freed=%llu held=%llu peakheld=%llu"
             " carved=%llu listhit=%llu listgive=%llu callocfallback=%llu\n",
          scr_cs_archunk, scr_cs_arfree, scr_cs_archunk - scr_cs_arfree,
          scr_cs_arpeak, scr_cs_arcarve, scr_cs_arhit, scr_cs_argive,
          scr_cs_arcalloc);
  if (scr_cs_arcarve == 0) {
    fprintf(f, "[cycstat] ARENA NEVER CARVED - either SCR_CYCLE_ARENA=0 or the"
               " arena is not reached. Not a measurement of the arena.\n");
  }
  fprintf(f, "[cycstat] strarena chunks=%llu carved=%llu listhit=%llu"
             " listgive=%llu mallocfallback=%llu\n",
          scr_cs_sarchunk, scr_cs_sarcarve, scr_cs_sarhit, scr_cs_sargive,
          scr_cs_sarmalloc);
  fprintf(f, "[cycstat] strarena reclaim taken=%llu freed=%llu charged=%llu"
             " foreign=%llu held=%llu\n",
          scr_cs_sarchunk, scr_cs_sarchunkfree, scr_cs_sarchunkgive,
          scr_cs_sarchunkforeign,
          scr_cs_sarchunk - scr_cs_sarchunkfree);
  /* The two ways "freed=0" happens, told apart LOUDLY rather than left to be
     inferred from a byte delta that is identical in both. */
  if (scr_cs_sarchunk > 0 && scr_cs_sarchunkfree == 0) {
    if (scr_cs_sarchunkgive == 0) {
      fprintf(f, "[cycstat] strarena NO CHUNK EVER FREED and NOTHING WAS EVER"
                 " CHARGED TO A CHUNK - the reclamation path did not run."
                 " Inert code, not a measurement of placement.\n");
    } else {
      fprintf(f, "[cycstat] strarena NO CHUNK EVER FREED, but %llu gives were"
                 " charged to a chunk - the path ran and no chunk reached"
                 " used==0. That is placement, not a bug.\n",
              scr_cs_sarchunkgive);
    }
  }
  fprintf(f, "[cycstat] strintern hit=%llu miss=%llu put=%llu evict=%llu"
             " refuse=%llu hitRate=%.4f evictPerPut=%.4f\n",
          scr_cs_sihit, scr_cs_simiss, scr_cs_siput, scr_cs_sievict,
          scr_cs_sirefuse,
          (scr_cs_sihit + scr_cs_simiss) > 0
              ? (double)scr_cs_sihit / (double)(scr_cs_sihit + scr_cs_simiss)
              : 0.0,
          scr_cs_siput > 0 ? (double)scr_cs_sievict / (double)scr_cs_siput
                           : 0.0);
  if (scr_cs_sievict == 0 && scr_cs_siput > 0) {
    fprintf(f, "[cycstat] STRING INTERN NEVER EVICTED - read this against the"
               " SCR_STRING_INTERN_WAYS=1 control on the SAME binary, which"
               " must evict heavily. A zero here with no such control is an"
               " untested branch, not a collision-free table.\n");
  }
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

/* ATEXIT ALONE CANNOT REPORT ON THIS TARGET, and this header spent a whole
 * measurement not knowing it.
 *
 * zapo's entry ends in `process.exit(0)`, which lowers to `_Exit` and skips
 * every atexit handler. So a cycstat-instrumented zapo run produced NO output
 * at all -- not the file named by SCR_CYCSTAT_OUT, not the stderr fallback,
 * not even the unconditional ARMED line whose entire job is to prove the
 * hooks compiled. From the outside that is indistinguishable from "the change
 * did nothing", which is the shape this tree has been bitten by repeatedly.
 * The binary was checked and DID carry the census (22 `cycstat` strings in the
 * exe, and a different sha from its uninstrumented sibling): compiled in,
 * never run.
 *
 * tests/perf/cycensus/scr_cyc_census.h already had this exact problem and
 * already solved it, in a comment eight lines long, one directory over. This
 * is that solution ported, not a second design.
 *
 * scr_cs_report is made IDEMPOTENT rather than relying on being called once:
 * both routes may fire in a program that exits normally after an interposed
 * `_Exit` never ran, and a doubled report is a corrupt one. */
__attribute__((constructor)) SCR_CS_FN void scr_cs_install(void) {
  scr_cs_arm();
}

/* COMPOSITION, stated because it is a footgun rather than a feature. A macro
 * cannot extend a macro it cannot name, so chaining is by explicit knowledge
 * of the other reporter -- exactly as cycensus chains onto scr_prof's. If
 * cycensus is also -include'd it must come FIRST, so that SCR_CYCEN_ON is
 * defined when this is read and both reports survive; included the other way
 * round, this one wins and cycensus's is silently lost. */
#ifdef _Exit
#undef _Exit
#endif
#ifdef SCR_CYCEN_ON
#define _Exit(c) (scr_cs_report(), scr_cycen_report(), _Exit(c))
#else
#define _Exit(c) (scr_cs_report(), _Exit(c))
#endif

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
#define SCR_CS_MAX(which, n)                                  \
  ((unsigned long long)(n) > scr_cs_##which                   \
       ? (void)(scr_cs_##which = (unsigned long long)(n))     \
       : (void)0)
#define SCR_CS_ARM() scr_cs_arm()

#else /* not armed: every hook is nothing at all */

#define SCR_CS_PASS_BEGIN() ((void)0)
#define SCR_CS_PASS_END() ((void)0)
#define SCR_CS_PHASE_BEGIN() ((void)0)
#define SCR_CS_PHASE_END(which) ((void)0)
#define SCR_CS_ADD(which, n) ((void)0)
#define SCR_CS_BUMP(which) ((void)0)
#define SCR_CS_MAX(which, n) ((void)0)
#define SCR_CS_ARM() ((void)0)

#endif /* SCR_CYCSTAT_ON */
#endif /* SCR_CYC_STAT_H */
