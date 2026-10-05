/* MIXED MODE: fibers and stackless frames in one scheduler, waking each other.
 *
 * "The scheduler already takes mixed types" has been an ARGUMENT -- three
 * dispatch arms in scr_resume_fiber and one FIFO -- and the whole hybrid rests
 * on it. This measures it.
 *
 * THE SUBJECT is a three-level chain A -> B -> C where each level awaits the
 * next, and EACH LEVEL INDEPENDENTLY is a fiber or a stackless frame. The
 * mode is a bitmask, so all 8 combinations run, including the two that matter
 * most: a stackless function awaiting a fiber one (mode 1) and a fiber
 * function awaiting a stackless one (mode 6). The call site is blind by
 * construction -- spawn_level answers a ScrPromise * either way and the
 * caller awaits it with its own mechanism, which is the ABI claim the hybrid
 * depends on.
 *
 * EVERY COMBINATION IS COMPARED AGAINST MODE 0 (all fibers), turn for turn.
 * The log stamps each event with the microtask turn it happened on, so a
 * crossing that cost one turn more or less than an all-fiber chain separates
 * immediately. That is the measurement; the rest is bookkeeping.
 *
 * Four variants, and the fourth is what makes the other three mean anything:
 *
 *   NORMAL  the leaf awaits a pending operand; the value walks back up.
 *   THROW   the leaf throws after its await, and the rejection crosses every
 *           boundary on the way up. This is the path where a LEAN frame
 *           borrows the ambient exception cell, and where a missing
 *           conversion once let a throw escape to the caller.
 *   ALS     an AsyncLocalStorage value is set, the chain is spawned, and the
 *           ambient is then changed to something else BEFORE the loop runs.
 *           Every level must still see the captured value. scr_switch carried
 *           that for free; scr_coro_resume_entry restores it by hand.
 *   ZERO    nothing happens: no level awaits anything. A mixed chain that
 *           cannot report "no turns, no suspensions" cannot be trusted when
 *           it reports that there were some.
 */
#include "scr_runtime.h"
#include "scr_coro.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define LEVELS 3
#define MODES  (1 << LEVELS)

enum { VAR_NORMAL = 0, VAR_THROW = 1, VAR_ALS = 2, VAR_ZERO = 3 };
static const char *VAR_NAME[4] = { "NORMAL", "THROW", "ALS", "ZERO" };

/* ── the turn ruler (same shape corostate uses) ───────────────────────── */
static long g_turn = 0;
static bool g_done = false;
static ScrPromise *g_top = NULL;
#define TURN_CAP 256

static void beacon(void *u) {
  (void)u;
  g_turn++;
  if (g_done) return;
  if (g_top != NULL && scr_coro_promise_settled(g_top)) return;
  if (g_turn >= TURN_CAP) return;
  scr_queue_microtask_raw(&beacon, NULL, NULL);
}

/* ── the log ──────────────────────────────────────────────────────────── */
#define LOG_MAX 256
static char g_log[LOG_MAX][80];
static int g_nlog = 0;

static int g_checking_als;
static int g_spawned_coro, g_spawned_fiber;
static int g_als_bad, g_als_seen;

static void logev(int level, const char *what, double als) {
  if (g_checking_als) {
    g_als_seen++;
    if (als != 42.0) g_als_bad++;
  }
  if (g_nlog >= LOG_MAX) return;
  snprintf(g_log[g_nlog], sizeof g_log[0], "turn=%ld L%d %s als=%.0f",
           g_turn, level, what, als);
  g_nlog++;
}

/* ── AsyncLocalStorage ────────────────────────────────────────────────── */
static double g_als_id;

static double als_now(void) {
  ScrDyn *d = scr_als_get(g_als_id);
  double v = scr_dyn_to_number(d);
  scr_dyn_release(d);
  return v; /* NaN when unset; printed as "nan", which is still a value to
             * compare between arms */
}

/* ── the awaited leaf operand: pending, settled from a later microtask ── */
static void settle_void(void *arg) {
  ScrPromise *p = (ScrPromise *)arg;
  scr_promise_fulfill_f64(p, 10.0);
  scr_promise_release(p);
}
static ScrPromise *leaf_operand(void) {
  ScrPromise *p = scr_promise_new();
  scr_queue_microtask_raw(&settle_void, scr_promise_retain(p), NULL);
  return p;
}

/* POSITIVE CONTROLS. Two ways this comparison could pass while measuring
 * nothing, both checked rather than assumed:
 *
 *  1. if spawn_level ignored the mode and always made fibers, every arm would
 *     be the all-fiber baseline and all 32 rows would match trivially. So the
 *     spawns are counted per kind and asserted against the bitmask.
 *  2. the ALS arm compares arms against each other, so a value that is wrong
 *     the SAME way everywhere passes. So the absolute value is asserted too:
 *     every level must observe 42, the captured snapshot, not the 7 that is
 *     ambient by the time the loop runs. */
typedef struct { int level, mode, variant; } LevelArgs;
static ScrPromise *spawn_level(int level, int mode, int variant);

/* ── ARM: a FIBER level ───────────────────────────────────────────────── */
static void fiber_level(ScrFiber *sc_self, void *sc_ap0) {
  LevelArgs a = *(LevelArgs *)sc_ap0;
  free(sc_ap0);
  logev(a.level, "enter", als_now());
  double v = 100.0;
  if (a.variant != VAR_ZERO) {
    if (a.level == LEVELS - 1) {
      ScrPromise *p = leaf_operand();
      v = scr_await_f64(p);
      scr_promise_release(p);
      if (!scr_exc_pending() && a.variant == VAR_THROW) {
        scr_throw_str(scr_str_new("boom", 4));
      }
    } else {
      ScrPromise *c = spawn_level(a.level + 1, a.mode, a.variant);
      v = scr_await_f64(c);
      scr_promise_release(c);
    }
  }
  if (scr_exc_pending()) return; /* the trampoline guard rejects */
  logev(a.level, "exit", als_now());
  scr_promise_fulfill_f64(scr_fiber_promise(sc_self), v + 1.0);
}

/* ── ARM: a STACKLESS level ───────────────────────────────────────────── */
typedef struct {
  ScrCoroBase base;
  int level, mode, variant;
  ScrPromise *child;
  double v;
} FrameLevel;

static void coro_level(ScrCoroBase *b) {
  FrameLevel *f = (FrameLevel *)b;
  if (f->base.state == 1) goto RESUME;

  logev(f->level, "enter", als_now());
  f->v = 100.0;
  if (f->variant == VAR_ZERO) goto DONE;
  f->child = (f->level == LEVELS - 1)
                 ? leaf_operand()
                 : spawn_level(f->level + 1, f->mode, f->variant);
  f->base.state = 1;
  scr_coro_park(b, f->child);
  return;

RESUME:
  f->v = scr_coro_take_f64(b, f->child);
  scr_promise_release(f->child);
  f->child = NULL;
  if (!scr_exc_pending() && f->level == LEVELS - 1 && f->variant == VAR_THROW) {
    scr_throw_str(scr_str_new("boom", 4));
  }
  if (scr_exc_pending()) { scr_coro_finish_throw(b); return; }

DONE:
  logev(f->level, "exit", als_now());
  scr_coro_finish_f64(b, f->v + 1.0);
}

/* ── the blind call site ──────────────────────────────────────────────── */
static ScrPromise *spawn_level(int level, int mode, int variant) {
#ifdef SCR_MIXED_NO_FRAMES
  /* The control's own control: ignore the bitmask and make everything a
   * fiber. Every row then compares the baseline against itself and all 32
   * match for the most boring possible reason. spawn_control must catch
   * it; if it does not, these rows prove nothing. */
  mode = 0;
#endif
  if (mode & (1 << level)) {
    FrameLevel *f = (FrameLevel *)scr_coro_alloc(sizeof *f, &coro_level, false);
    f->level = level;
    f->mode = mode;
    f->variant = variant;
    g_spawned_coro++;
    return scr_coro_spawn(&f->base);
  }
  LevelArgs *ap = (LevelArgs *)malloc(sizeof *ap);
  if (!ap) abort();
  ap->level = level;
  ap->mode = mode;
  ap->variant = variant;
  g_spawned_fiber++;
  return scr_async_spawn(&fiber_level, ap);
}

/* ── the driver ───────────────────────────────────────────────────────── */
static void quiesce(void) {
  g_done = true;
  g_top = NULL;
  (void)scr_loop_run(NULL);
}

static int run_mode(int mode, int variant, char out[LOG_MAX][80], int *nout,
                    double *result, int *rejected) {
  quiesce();
  g_nlog = 0;
  g_turn = 0;
  g_done = false;
  g_spawned_coro = 0;
  g_spawned_fiber = 0;
  g_checking_als = (variant == VAR_ALS);

  ScrAlsCtx *prev = NULL;
  if (variant == VAR_ALS) {
    ScrDyn *v = scr_dyn_new_num(42.0);
    prev = scr_als_enter(g_als_id, v);
    scr_dyn_release(v);
  }
  ScrPromise *p = spawn_level(0, mode, variant);
  if (variant == VAR_ALS) {
    /* Change the AMBIENT context before the loop runs: a level that reads the
     * ambient instead of its own captured snapshot now sees 7, not 42. */
    scr_als_restore(prev);
    ScrDyn *other = scr_dyn_new_num(7.0);
    ScrAlsCtx *p2 = scr_als_enter(g_als_id, other);
    scr_dyn_release(other);
    prev = p2;
  }

  g_top = p;
  scr_queue_microtask_raw(&beacon, NULL, NULL);
  (void)scr_loop_run(p);
  g_top = NULL;

  *rejected = scr_coro_promise_rejected(p) ? 1 : 0;
  *result = (scr_coro_promise_settled(p) && !*rejected)
                ? scr_coro_promise_f64(p) : -1.0;
  scr_promise_mark_handled(p);
  scr_promise_release(p);
  if (variant == VAR_ALS) scr_als_restore(prev);
  scr_exc_clear();

  memcpy(out, g_log, sizeof g_log);
  *nout = g_nlog;
  return 0;
}

static int popcount3(int m) { return ((m >> 0) & 1) + ((m >> 1) & 1) + ((m >> 2) & 1); }

/* The spawn-kind control: how many levels actually ran as frames, against how
 * many the bitmask asked for. ZERO spawns only level 0 (it never reaches a
 * child), so its expectation is the single bit 0. */
static int spawn_control(int mode, int variant) {
  int want_total = (variant == VAR_ZERO) ? 1 : LEVELS;
  int want_coro  = (variant == VAR_ZERO) ? (mode & 1) : popcount3(mode);
  int got_total  = g_spawned_coro + g_spawned_fiber;
  if (got_total != want_total || g_spawned_coro != want_coro) {
    printf("        CONTROL FAILED: mode asked for %d frame(s) of %d level(s),"
           " got %d of %d -- the bitmask is not reaching spawn_level, so these"
           " rows compare nothing\n",
           want_coro, want_total, g_spawned_coro, got_total);
    return 1;
  }
  return 0;
}

static void mode_name(int mode, char *buf, size_t n) {
  /* L0L1L2, F = fiber, S = stackless */
  size_t i;
  for (i = 0; i < LEVELS && i + 1 < n; i++)
    buf[i] = (mode & (1 << i)) ? 'S' : 'F';
  buf[i] = 0;
}

static int compare_variant(int variant) {
  static char base[LOG_MAX][80];
  static char cur[LOG_MAX][80];
  int nbase = 0, ncur = 0, rb = 0, rc = 0;
  double vb = 0, vc = 0;
  int bad = 0;
  char nm[8];

  printf("=== variant %s ===\n", VAR_NAME[variant]);
  run_mode(0, variant, base, &nbase, &vb, &rb);
  bad += spawn_control(0, variant);
  mode_name(0, nm, sizeof nm);
  printf("  %-4s (baseline, all fibers)  turns=%ld events=%d result=%.0f%s\n",
         nm, g_turn, nbase, vb, rb ? " REJECTED" : "");
  long base_turns = g_turn;

  for (int mode = 1; mode < MODES; mode++) {
    run_mode(mode, variant, cur, &ncur, &vc, &rc);
    bad += spawn_control(mode, variant);
    mode_name(mode, nm, sizeof nm);
    int mism = 0;
    if (ncur != nbase) mism++;
    if (vc != vb || rc != rb) mism++;
    int lim = ncur < nbase ? ncur : nbase;
    for (int i = 0; i < lim; i++)
      if (strcmp(base[i], cur[i]) != 0) mism++;
    printf("  %-4s turns=%ld events=%d result=%.0f%s  %s\n", nm, g_turn, ncur,
           vc, rc ? " REJECTED" : "", mism == 0 ? "identical to baseline" : "MISMATCH");
    if (mism != 0) {
      bad++;
      for (int i = 0; i < lim; i++)
        if (strcmp(base[i], cur[i]) != 0)
          printf("        [%d] FFF{%s}  %s{%s}\n", i, base[i], nm, cur[i]);
      if (ncur != nbase)
        printf("        event count %d vs %d\n", nbase, ncur);
      if (g_turn != base_turns)
        printf("        TURN COUNT %ld vs %ld -- the crossing changed the"
               " schedule\n", base_turns, g_turn);
    }
  }
  printf("\n");
  return bad;
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  g_als_id = scr_als_new();

  printf("coromixed -- fibers and stackless frames in one scheduler\n");
  printf("chain A->B->C, each level independently F(iber) or S(tackless);\n");
  printf("all %d combinations compared turn-for-turn against all-fibers.\n\n",
         MODES);

  int bad = 0;
  bad += compare_variant(VAR_NORMAL);
  bad += compare_variant(VAR_THROW);
  bad += compare_variant(VAR_ALS);
  bad += compare_variant(VAR_ZERO);

  if (g_als_seen == 0) {
    printf("CONTROL FAILED: the ALS arm observed nothing, so it cannot have checked anything.\n");
    bad++;
  } else if (g_als_bad != 0) {
    printf("ALS BROKEN: %d of %d observations were not the captured 42 -- the chain is reading the ambient context, not its own snapshot.\n",
           g_als_bad, g_als_seen);
    bad++;
  } else {
    printf("ALS control: all %d observations across all 8 modes saw the captured 42, while 7 was ambient.\n\n", g_als_seen);
  }

  printf("%s\n", bad == 0
      ? "coromixed: EVERY MIXED COMBINATION MATCHES ALL-FIBERS"
      : "coromixed: MISMATCHES FOUND");
  return bad == 0 ? 0 : 1;
}
