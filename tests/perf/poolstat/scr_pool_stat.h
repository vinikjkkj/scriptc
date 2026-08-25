/* scr_pool_stat.h - THE CONTROL for SCR_POOL_BUDGET: does the bound ever bind?
 *
 * WHY THIS EXISTS
 * ---------------
 * `scr_runtime.h` ships `SCR_POOL_BUDGET`, a total-physical-bytes bound on
 * one size-class pool, defaulting to 0 (off, per-class depth instead). The
 * open question it was left off for is peak RSS on zapo, and an A/B of peak
 * RSS is only worth running if the knob CHANGES SOMETHING on zapo. A budget
 * that is never reached cannot move peak RSS by a byte, and an A/B over an
 * inert change is indistinguishable from a real null.
 *
 * So this header answers the control question by an exact count, before any
 * A/B: for every pool in the program, how many blocks pass through it, how
 * many bytes it holds at its own high-water mark, and how many gives the
 * ACTIVE bound rejects. It also computes, over the same retention history,
 * how many gives a set of OTHER bounds would have turned away - so one run
 * prices the whole curve rather than one point.
 *
 * THERE ARE FOUR POOLS, NOT TWO. scr_runtime.h's block comment prices the
 * worst case as "270 KiB, and there are two pools". The tree has four
 * `static ScrPool`: scr_cyc_blocks (scr_cycle.c), scr_str_blocks
 * (scr_string.c), scr_json_key_blocks and scr_dyn_ext_blocks (both
 * scr_json.c). Each is registered by name from its own TU, so the report
 * cannot silently attribute one pool's traffic to another.
 *
 * WHAT IT COSTS AND WHERE THAT MATTERS
 * ------------------------------------
 * Everything here is off unless SCR_POOLSTAT_ON is defined, which happens
 * only when this header is -include'd. The hooks in scr_runtime.h and the
 * registrations in the three .c files are `#ifdef SCR_POOLSTAT_ON` lines;
 * with the header absent the symbol is undefined and every one of them
 * vanishes, so an uninstrumented build carries no instruction of this.
 * That is checked by preprocessing both ways and diffing, not assumed.
 *
 * An instrumented binary is NOT a peak-RSS arm: the table is BSS the
 * program would not otherwise touch and the hooks are calls on the two
 * hottest functions in the runtime. It answers "does the bound bind",
 * which is a question about counts. Peak RSS is measured on clean arms.
 *
 * HOW TO USE IT
 *   SCRIPTC_PROF_CFLAGS="-include <repo>/tests/perf/poolstat/scr_pool_stat.h"
 *   SCR_POOLSTAT_OUT=<file>         where the report is written
 *   -DSCR_POOLSTAT_ARM=N            plant a known population; the reader
 *                                   refuses every number without it
 *
 * THE ARM, and why the reader refuses without it. An instrument that can
 * only ever answer "nothing happened" passes a null workload perfectly and
 * is worthless. -DSCR_POOLSTAT_ARM=N drives N real gives and then N real
 * takes of one known size through a real ScrPool of scr_cycle.c's, at the
 * constructor, before the program starts - through the same
 * scr_pool_give/scr_pool_take and therefore the same hooks every other row
 * is counted by. Its row is named "ARM" and its expected contents are
 * arithmetic:
 *     budget off, depth 64:  gives=N accepts=64   rejects=N-64  hits=64
 *     budget 16 MiB:         gives=N accepts=N    rejects=0     hits=N
 * so the arm distinguishes the two POLICIES as well as proving the counts
 * move. tests/perf/poolstat/read-poolstat.mjs refuses a report whose ARM
 * row is missing or does not match.
 *
 * NO <windows.h>: this header is -include'd into every runtime TU and
 * `scr_fetch_dispatch.c` collides with it on `fd_set`. Nothing here needs
 * a platform header.
 */
#ifndef SCR_POOL_STAT_H
#define SCR_POOL_STAT_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The switch scr_runtime.h's hook lines test. */
#define SCR_POOLSTAT_ON 1

/* Linkage is scr_cyc_census.h's, for its reason: on x86_64-windows-gnu a
 * `weak` definition in every TU is a duplicate-symbol error per TU rather
 * than one merged instance. Data is selectany (COMDAT, merged, ONE
 * counter), functions are static (per-TU code over that one shared
 * state). */
#define SCR_POOLSTAT_SHARED __attribute__((selectany))
#define SCR_POOLSTAT_FN \
  static __attribute__((unused)) __attribute__((no_instrument_function))

/* Pools are few and known; 16 is four times the four that exist, and an
 * overflow bumps scr_poolstat_lost, which the report prints and the reader
 * refuses on, so a missing pool can never read as a zero. */
#define SCR_POOLSTAT_POOLS 16u
/* SCR_POOL_MAX / SCR_POOL_GRAIN - but this header is -include'd BEFORE
 * scr_runtime.h, so those macros do not exist here yet. 64 covers a grain
 * of 4 at the shipped max of 256; a class index past the end is clamped
 * onto the last row rather than scribbling past it. */
#define SCR_POOLSTAT_CLASSES 64u

/* The counterfactual bounds, in bytes. Column 0 is the 16 MiB the curve in
 * scr_runtime.h was measured at; the rest bracket it downward so one run
 * says where the knee is on THIS workload rather than on the messaging
 * bench's. */
#define SCR_POOLSTAT_BOUNDS 8u
SCR_POOLSTAT_SHARED unsigned long long scr_poolstat_bound[SCR_POOLSTAT_BOUNDS] = {
  16777216ULL, 4194304ULL, 1048576ULL, 262144ULL,
  65536ULL, 16384ULL, 4096ULL, 1024ULL
};

typedef struct {
  const void *p;    /* the ScrPool address. NULL = empty row. */
  const char *name; /* registered from the pool's own TU. */
  unsigned long long take_calls, take_oor, hits;
  unsigned long long give_calls, give_oor, accepts, rejects;
  /* The shadow of the pool's retention. It mirrors the ACTIVE policy
   * exactly, because these hooks fire on exactly the events that change
   * the pool: +r on an accepted give, -r on a hit, and nothing else can
   * add or remove a block. */
  unsigned long long bytes_now, bytes_max;
  unsigned long long depth_now[SCR_POOLSTAT_CLASSES];
  unsigned long long depth_max[SCR_POOLSTAT_CLASSES];
  /* Counterfactuals over the SAME retention history: how many in-range
   * gives each bound would have turned away, and how many the shipped
   * per-class depth of 64 would have. */
  unsigned long long would_reject[SCR_POOLSTAT_BOUNDS];
  unsigned long long would_reject_depth64;
  unsigned long long bytes_accepted; /* sum of r over accepted gives */
} ScrPoolStatRow;

SCR_POOLSTAT_SHARED ScrPoolStatRow scr_poolstat_tbl[SCR_POOLSTAT_POOLS] = {{0}};
SCR_POOLSTAT_SHARED unsigned scr_poolstat_rows = 0;
SCR_POOLSTAT_SHARED unsigned long long scr_poolstat_lost = 0;
SCR_POOLSTAT_SHARED int scr_poolstat_reported = 0;
SCR_POOLSTAT_SHARED int scr_poolstat_installed = 0;
SCR_POOLSTAT_SHARED unsigned long long scr_poolstat_arm_ran = 0;
/* The build's own pool configuration, handed over from a TU that has
 * already seen scr_runtime.h. -1 until then, so a report written by a
 * build whose registrations did not compile says so instead of printing a
 * plausible zero. */
SCR_POOLSTAT_SHARED unsigned long long scr_poolstat_cfg_grain = 0;
SCR_POOLSTAT_SHARED unsigned long long scr_poolstat_cfg_max = 0;
SCR_POOLSTAT_SHARED unsigned long long scr_poolstat_cfg_depth = 0;
SCR_POOLSTAT_SHARED unsigned long long scr_poolstat_cfg_budget = 0;
SCR_POOLSTAT_SHARED int scr_poolstat_cfg_seen = 0;

SCR_POOLSTAT_FN void scr_poolstat_cfg(unsigned long long grain, unsigned long long max,
                                      unsigned long long depth, unsigned long long budget) {
  scr_poolstat_cfg_grain = grain;
  scr_poolstat_cfg_max = max;
  scr_poolstat_cfg_depth = depth;
  scr_poolstat_cfg_budget = budget;
  scr_poolstat_cfg_seen = 1;
}

/* A pool with no registration is an UNKNOWN row, not a missing one: this
 * creates one named "?" so its traffic is still counted and still visibly
 * unattributed. */
SCR_POOLSTAT_FN ScrPoolStatRow *scr_poolstat_row(const void *p) {
  unsigned i;
  for (i = 0; i < scr_poolstat_rows; i++)
    if (scr_poolstat_tbl[i].p == p) return &scr_poolstat_tbl[i];
  if (scr_poolstat_rows >= SCR_POOLSTAT_POOLS) { scr_poolstat_lost++; return 0; }
  {
    ScrPoolStatRow *r = &scr_poolstat_tbl[scr_poolstat_rows++];
    r->p = p;
    r->name = "?";
    return r;
  }
}

SCR_POOLSTAT_FN void scr_poolstat_name(const void *p, const char *name) {
  ScrPoolStatRow *r = scr_poolstat_row(p);
  if (r) r->name = name;
}

/* The class index is derived here rather than passed, so the hook lines in
 * scr_runtime.h stay one expression wide and cannot be handed the wrong
 * index by a later edit. */
SCR_POOLSTAT_FN unsigned scr_poolstat_class(unsigned long long r) {
  unsigned long long g = scr_poolstat_cfg_grain ? scr_poolstat_cfg_grain : 8ULL;
  unsigned long long c = r / g;
  if (c == 0) return 0;
  c -= 1;
  return c < SCR_POOLSTAT_CLASSES ? (unsigned)c : SCR_POOLSTAT_CLASSES - 1u;
}

SCR_POOLSTAT_FN int scr_poolstat_in_range(unsigned long long r) {
  return r != 0 && r <= (scr_poolstat_cfg_max ? scr_poolstat_cfg_max : 256ULL);
}

SCR_POOLSTAT_FN void scr_poolstat_take_call(const void *p, unsigned long long r) {
  ScrPoolStatRow *w = scr_poolstat_row(p);
  if (!w) return;
  w->take_calls++;
  if (!scr_poolstat_in_range(r)) w->take_oor++;
}

SCR_POOLSTAT_FN void scr_poolstat_hit(const void *p, unsigned long long r) {
  ScrPoolStatRow *w = scr_poolstat_row(p);
  unsigned c;
  if (!w) return;
  c = scr_poolstat_class(r);
  w->hits++;
  w->bytes_now -= r;
  if (w->depth_now[c]) w->depth_now[c]--;
}

SCR_POOLSTAT_FN void scr_poolstat_give_call(const void *p, unsigned long long r) {
  ScrPoolStatRow *w = scr_poolstat_row(p);
  unsigned c, i;
  if (!w) return;
  w->give_calls++;
  if (!scr_poolstat_in_range(r)) { w->give_oor++; return; }
  c = scr_poolstat_class(r);
  for (i = 0; i < SCR_POOLSTAT_BOUNDS; i++)
    if (w->bytes_now + r > scr_poolstat_bound[i]) w->would_reject[i]++;
  if (w->depth_now[c] >= 64) w->would_reject_depth64++;
}

SCR_POOLSTAT_FN void scr_poolstat_accept(const void *p, unsigned long long r) {
  ScrPoolStatRow *w = scr_poolstat_row(p);
  unsigned c;
  if (!w) return;
  c = scr_poolstat_class(r);
  w->accepts++;
  w->bytes_accepted += r;
  w->bytes_now += r;
  if (w->bytes_now > w->bytes_max) w->bytes_max = w->bytes_now;
  w->depth_now[c]++;
  if (w->depth_now[c] > w->depth_max[c]) w->depth_max[c] = w->depth_now[c];
}

SCR_POOLSTAT_FN void scr_poolstat_reject(const void *p) {
  ScrPoolStatRow *w = scr_poolstat_row(p);
  if (w) w->rejects++;
}

SCR_POOLSTAT_FN void scr_poolstat_report(void) {
  if (scr_poolstat_reported) return;
  scr_poolstat_reported = 1;
  {
    const char *path = getenv("SCR_POOLSTAT_OUT");
    FILE *f = fopen(path && *path ? path : "scr-poolstat.txt", "w");
    unsigned i, b, c;
    if (!f) return;
    fprintf(f,
            "POOLSTAT-HEAD cfgSeen=%d budget=%llu depth=%llu grain=%llu max=%llu "
            "rows=%u lost=%llu arm=%llu classes=%u\n",
            scr_poolstat_cfg_seen, scr_poolstat_cfg_budget, scr_poolstat_cfg_depth,
            scr_poolstat_cfg_grain, scr_poolstat_cfg_max, scr_poolstat_rows,
            scr_poolstat_lost, scr_poolstat_arm_ran, SCR_POOLSTAT_CLASSES);
    for (i = 0; i < SCR_POOLSTAT_BOUNDS; i++)
      fprintf(f, "POOLSTAT-BOUND %u %llu\n", i, scr_poolstat_bound[i]);
    for (i = 0; i < scr_poolstat_rows; i++) {
      ScrPoolStatRow *w = &scr_poolstat_tbl[i];
      unsigned long long dmax = 0, dsum = 0;
      for (c = 0; c < SCR_POOLSTAT_CLASSES; c++) {
        if (w->depth_max[c] > dmax) dmax = w->depth_max[c];
        dsum += w->depth_now[c];
      }
      fprintf(f,
              "POOLSTAT %s addr=%llx takeCalls=%llu takeOOR=%llu hits=%llu "
              "giveCalls=%llu giveOOR=%llu accepts=%llu rejects=%llu "
              "bytesNow=%llu bytesMax=%llu bytesAccepted=%llu blocksNow=%llu "
              "depthMax=%llu wouldRejectDepth64=%llu",
              w->name, (unsigned long long)(size_t)w->p, w->take_calls, w->take_oor,
              w->hits, w->give_calls, w->give_oor, w->accepts, w->rejects,
              w->bytes_now, w->bytes_max, w->bytes_accepted, dsum, dmax,
              w->would_reject_depth64);
      for (b = 0; b < SCR_POOLSTAT_BOUNDS; b++)
        fprintf(f, " wr%u=%llu", b, w->would_reject[b]);
      fprintf(f, "\n");
      for (c = 0; c < SCR_POOLSTAT_CLASSES; c++)
        if (w->depth_max[c])
          fprintf(f, "POOLSTAT-CLASS %s %u %llu %llu\n", w->name, c, w->depth_max[c],
                  w->depth_now[c]);
    }
    fprintf(f, "POOLSTAT-END\n");
    fclose(f);
  }
}

/* One constructor per TU that includes this header, deduped on a SHARED
 * flag rather than a per-TU static: a per-TU `static int done` does not
 * dedupe across the 38 runtime units, and neither does registering the
 * same atexit handler 38 times, but the shared flag makes the count 1 and
 * says so. */
__attribute__((constructor)) SCR_POOLSTAT_FN void scr_poolstat_install(void) {
  if (scr_poolstat_installed) return;
  scr_poolstat_installed = 1;
  atexit(scr_poolstat_report);
}

/* atexit alone cannot report on this target: zapo's entry ends in
 * process.exit(0), which lowers to _Exit and skips every atexit handler.
 * The interposer below closes that. The inner _Exit is not re-expanded
 * (a macro is not expanded inside its own replacement), so this is a
 * one-level interposition, not a recursion.
 *
 * If another lane has already interposed _Exit the chain would be silently
 * broken, so that is an error rather than a lost report. */
#ifdef _Exit
#error "scr_pool_stat.h must be -include'd before any lane that interposes _Exit"
#endif
#define _Exit(c) (scr_poolstat_report(), _Exit(c))

#endif /* SCR_POOL_STAT_H */
