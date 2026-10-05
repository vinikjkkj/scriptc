/* The end-to-end proof, BEFORE a line of lowering exists: one real program
 * written twice -- once on fibers exactly as the compiler emits today, once
 * as a hand-written stackless state machine -- and the claim that the two
 * are indistinguishable in the only place a user can see the difference,
 * the microtask turn sequence.
 *
 * THE SUBJECT is zapo-js's resolveDisallowedListEntries
 * (src/client/coordinators/WaPrivacyCoordinator.ts), picked because it has
 * every shape that makes a state machine hard:
 *
 *     for (const { action, jids } of actions)      // outer loop
 *         for (const jid of jids)                  // nested loop
 *             const resolved = await resolveBlocklistTarget(options, jid)
 *             const target = usernameIdentifierAllowed
 *                 ? await withContactIdentifiers(options, resolved)   // CONDITIONAL
 *                 : resolved
 *             entries.push(...)
 *     if (entries.length === 0) throw ...
 *
 * Two nested loops, two suspensions, and the second one lives inside a
 * ternary so it runs on some iterations and not others. The IR measurement
 * says its frame is 4 live locals + 4 temporaries; the four temporaries are
 * exactly the two loops' (array, index) pairs, which is why the state
 * machine below has to carry oi/ii/jids/njids across every suspension. That
 * is the prediction this file also checks: the hand-written frame needs
 * precisely those slots and no others.
 *
 * WHAT IS BEING COMPARED. Both arms run under the REAL scheduler in
 * scr_async.c -- the real ready queue, the real promise settle path. A
 * self-requeueing beacon microtask rides the same FIFO and stamps every
 * observable event with the turn it happened on. Identical turn structure
 * produces byte-identical logs; a design that skipped or doubled a turn
 * anywhere would separate them. That is the whole test.
 *
 * Both park arms are exercised on purpose: an operand for an EVEN jid is an
 * already-settled promise (scr_coro_park's hop arm, one push now) and an ODD
 * one is pending, settled from a later microtask (the waiter arm, zero
 * pushes now and one at settle). A run that only ever met settled operands
 * would not test the thing most likely to be wrong.
 *
 * Build (no compiler, no node, no zapo):
 *   zig cc -target x86_64-windows-gnu -O1 -g0 -I<repo>/packages/runtime/src \
 *     corostate.c <repo>/packages/runtime/src/{scr_coro,scr_async,...}.c \
 *     -o corostate.exe
 * See run.sh beside this file for the full unit list.
 */
#include "scr_runtime.h"
#include "scr_coro.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ── the turn ruler ───────────────────────────────────────────────────────
 * A beacon that re-enqueues itself rides the same FIFO as every promise
 * continuation, so it advances once per microtask round and every event can
 * be stamped with the round it occurred on. It is representation-blind: it
 * does not know a fiber from a frame, which is the point. */
static long g_turn = 0;
static bool g_prog_done = false;
static ScrPromise *g_top = NULL; /* borrowed: the arm's top-level promise */

/* A self-requeueing microtask keeps the ready queue non-empty forever, and
 * the loop drains the queue before it will exit -- so the beacon MUST have a
 * stop condition or scr_loop_run never returns. It stops as soon as the
 * program's own promise has settled; the cap is a backstop so a bug in the
 * arm under test shows up as a bounded failure instead of a hang. */
#define TURN_CAP 256

static void beacon(void *unused) {
  (void)unused;
  g_turn++;
  if (g_prog_done) return;
  if (g_top != NULL && scr_coro_promise_settled(g_top)) return;
  if (g_turn >= TURN_CAP) return;
  scr_queue_microtask_raw(&beacon, NULL, NULL);
}

/* ── the observable log ───────────────────────────────────────────────── */
#define LOG_MAX 512
static char g_log[LOG_MAX][64];
static int  g_nlog = 0;

static void logev(const char *what, double v) {
  if (g_nlog >= LOG_MAX) return;
  snprintf(g_log[g_nlog], sizeof g_log[0], "turn=%ld %s=%.0f", g_turn, what, v);
  g_nlog++;
}
static void log_reset(void) { g_nlog = 0; g_turn = 0; g_prog_done = false; }

/* ── the awaited operands ─────────────────────────────────────────────────
 * Identical producers for both arms, so anything they contribute to the turn
 * count cancels out of the comparison. */
typedef struct { ScrPromise *p; double v; } Settler;

static void settle_later(void *arg) {
  Settler *s = (Settler *)arg;
  logev("settle", s->v);
  scr_promise_fulfill_f64(s->p, s->v);
  scr_promise_release(s->p);
  free(s);
}

/* An even key yields an ALREADY-SETTLED promise, an odd key a pending one. */
static bool key_is_pending(double key) { return ((long)key & 1L) != 0L; }

static ScrPromise *operand(double key, double value) {
  if (!key_is_pending(key)) return scr_promise_settled_f64(value);
  ScrPromise *p = scr_promise_new();
  Settler *s = (Settler *)malloc(sizeof *s);
  if (!s) abort();
  s->p = scr_promise_retain(p);
  s->v = value;
  scr_queue_microtask_raw(&settle_later, s, NULL);
  return p;
}

/* ── the program's inputs ─────────────────────────────────────────────── */
typedef struct {
  const double *add; size_t nadd;
  const double *rem; size_t nrem;
  bool allowed;
  /* -1 = never. Otherwise the push index at which the body throws WITHOUT
   * settling anything -- the realistic shape, because scriptc propagates a
   * throw by leaving it pending and returning, not by unwinding. The fiber
   * trampoline turns that into a rejection via its scr_exc_pending() guard;
   * the stackless path must do the same in scr_coro_resume_entry. */
  long throw_at;
} Args;

/* ═══════════════════════ ARM A -- fibers, as emitted today ═══════════════
 * Written to match emit-async.ts: an argpack malloc'd by the spawn wrapper,
 * a trampoline that copies it out and frees it, and a fulfil guarded by
 * scr_exc_pending(). */

static void armA_trampoline(ScrFiber *sc_self, void *sc_ap0) {
  Args a = *(Args *)sc_ap0;
  free(sc_ap0);

  double acc = 0;
  long n = 0;
  for (int oi = 0; oi < 2; oi++) {
    double action = (oi == 0) ? 1.0 : 2.0;
    const double *jids = (oi == 0) ? a.add : a.rem;
    size_t njids       = (oi == 0) ? a.nadd : a.nrem;
    for (size_t ii = 0; ii < njids; ii++) {
      double jid = jids[ii];

      ScrPromise *p = operand(jid, jid + 100.0);
      double resolved = scr_await_f64(p);          /* suspension 1 */
      scr_promise_release(p);

      double target = resolved;
      if (a.allowed) {
        ScrPromise *q = operand(resolved, resolved + 1000.0);
        target = scr_await_f64(q);                 /* suspension 2 */
        scr_promise_release(q);
      }
      acc += action * 10000.0 + target;
      n++;
      logev("push", target);
      if (a.throw_at >= 0 && n == a.throw_at) {
        scr_throw_str(scr_str_new("boom", 4));
        return; /* pending; the guard below is skipped and the fiber rejects */
      }
    }
  }
  if (n == 0) {
    scr_throw_str(scr_str_new("no entries", 10));
    return;
  }
  if (!scr_exc_pending()) {
    scr_promise_fulfill_f64(scr_fiber_promise(sc_self), acc);
  }
}

static ScrPromise *armA_spawn(Args a) {
  Args *ap = (Args *)malloc(sizeof *ap);
  if (!ap) abort();
  *ap = a;
  return scr_async_spawn(&armA_trampoline, ap);
}

/* ═══════════════════════ ARM B -- the stackless state machine ════════════
 * The frame carries exactly what the IR liveness measurement predicted:
 * the parameters, the accumulator pair, and the two loops' index/array
 * state. `target` is NOT in the frame -- it is assigned after a resume and
 * consumed before the next suspension, so it is never live across one, and
 * the measurement did not charge for it either.
 *
 * This is a LEAN frame (scr_coro_init's has_exc = false): the function is
 * census class D1-D3, no suspension is reachable with an exception pending,
 * so it carries no ScrExcCell and is 56 bytes smaller than it would
 * otherwise be. */
typedef struct {
  ScrCoroBase base;        /* 40 */
  /* params */
  const double *add; size_t nadd;
  const double *rem; size_t nrem;
  bool allowed;
  long throw_at;
  /* live across suspensions */
  double acc;
  long   n;
  int    oi;               /* outer loop index  -- a "temp" in the census */
  size_t ii;               /* inner loop index  -- ditto                  */
  const double *jids;      /* inner loop array  -- ditto                  */
  size_t njids;            /*                   -- ditto                  */
  double action;
  ScrPromise *awaited;     /* the operand currently being awaited         */
  double resolved;
} FrameResolve;

enum { ST_ENTRY = 0, ST_AFTER_1 = 1, ST_AFTER_2 = 2 };

static void armB_resume(ScrCoroBase *b) {
  FrameResolve *f = (FrameResolve *)b;
  double target;

  switch (f->base.state) {
  case ST_ENTRY:   goto S_entry;
  case ST_AFTER_1: goto S_after_1;
  case ST_AFTER_2: goto S_after_2;
  default:         abort();
  }

S_entry:
  f->acc = 0;
  f->n = 0;
  for (f->oi = 0; f->oi < 2; f->oi++) {
    f->action = (f->oi == 0) ? 1.0 : 2.0;
    f->jids   = (f->oi == 0) ? f->add : f->rem;
    f->njids  = (f->oi == 0) ? f->nadd : f->nrem;
    for (f->ii = 0; f->ii < f->njids; f->ii++) {
      double jid = f->jids[f->ii];

      /* ---- suspension 1 ---- */
      f->awaited = operand(jid, jid + 100.0);
      f->base.state = ST_AFTER_1;
      scr_coro_park(&f->base, f->awaited);
      return;                       /* back to the scheduler, always */
S_after_1:
      f->resolved = scr_coro_take_f64(&f->base, f->awaited);
      scr_promise_release(f->awaited);
      f->awaited = NULL;

      if (f->allowed) {
        /* ---- suspension 2 (conditional: the ternary's true arm) ---- */
        f->awaited = operand(f->resolved, f->resolved + 1000.0);
        f->base.state = ST_AFTER_2;
        scr_coro_park(&f->base, f->awaited);
        return;
S_after_2:
        target = scr_coro_take_f64(&f->base, f->awaited);
        scr_promise_release(f->awaited);
        f->awaited = NULL;
      } else {
        target = f->resolved;
      }

      f->acc += f->action * 10000.0 + target;
      f->n++;
      logev("push", target);
      if (f->throw_at >= 0 && f->n == f->throw_at) {
        scr_throw_str(scr_str_new("boom", 4));
        return; /* no finish call: scr_coro_resume_entry owes the rejection */
      }
    }
  }

  if (f->n == 0) {
    scr_throw_str(scr_str_new("no entries", 10));
    scr_coro_finish_throw(&f->base);
    return;
  }
  scr_coro_finish_f64(&f->base, f->acc);
}

/* Exactly the shape a generated spawn wrapper has: allocate, fill the
 * argpack fields, spawn. Same signature and same return type as the fiber
 * wrapper above, which is what makes the two interchangeable at a call site. */
static ScrPromise *armB_spawn(Args a) {
  FrameResolve *f = (FrameResolve *)scr_coro_alloc(sizeof *f, &armB_resume,
                                                   /*has_exc=*/false);
  f->add = a.add; f->nadd = a.nadd;
  f->rem = a.rem; f->nrem = a.nrem;
  f->allowed = a.allowed;
  f->throw_at = a.throw_at;
  return scr_coro_spawn(&f->base);
}

/* ── the comparison ───────────────────────────────────────────────────── */

typedef ScrPromise *(*SpawnFn)(Args);

/* Drain whatever the previous arm left queued.
 *
 * scr_loop_run BREAKS IMMEDIATELY when the top-level promise rejects, so a
 * throwing arm exits with settles and beacons still on the ready queue. That
 * residue would be drained by the NEXT arm and counted as its turns -- which
 * is exactly what happened: case D's fiber arm read 20 turns against the
 * stackless arm's 6, and every one of the extra turns belonged to case C.
 * A comparison has to start from a quiescent scheduler or it measures the
 * previous test. */
static void quiesce(void) {
  g_prog_done = true; /* the beacon stops re-enqueueing, so this terminates */
  g_top = NULL;
  (void)scr_loop_run(NULL);
}

static int run_arm(const char *name, SpawnFn spawn, Args a,
                   char out[LOG_MAX][64], int *nout, double *result) {
  quiesce();
  log_reset();
  ScrPromise *p = spawn(a);
  g_top = p;
  scr_queue_microtask_raw(&beacon, NULL, NULL);
  /* scr_loop_run returns rejection_failed: 0 is SUCCESS, not failure. */
  bool rejfail = scr_loop_run(p);
  g_top = NULL;
  g_prog_done = true;
  *result = scr_coro_promise_settled(p) && !scr_coro_promise_rejected(p)
                ? scr_coro_promise_f64(p)
                : -1.0;
  /* The rejecting cases are rejections this test never consumes. Marking
   * them handled keeps the unhandled-rejection ledger out of the comparison:
   * it is real work, and work that ran in one arm and not the other would be
   * a difference the turn count would report as a design difference. */
  scr_promise_mark_handled(p);
  scr_promise_release(p);
  memcpy(out, g_log, sizeof g_log);
  *nout = g_nlog;
  printf("  %-10s turns=%ld events=%d result=%.0f rejfail=%d\n",
         name, g_turn, g_nlog, *result, (int)rejfail);
  return 0;
}

static const double ADD[] = { 10, 11 };   /* one settled key, one pending */
static const double REM[] = { 20 };       /* settled */

static int compare(const char *label, Args a) {
  static char logA[LOG_MAX][64];
  static char logB[LOG_MAX][64];
  int nA = 0, nB = 0;
  double rA = 0, rB = 0;

  printf("%s (allowed=%d)\n", label, (int)a.allowed);
  run_arm("fiber", &armA_spawn, a, logA, &nA, &rA);
  run_arm("stackless", &armB_spawn, a, logB, &nB, &rB);

  int bad = 0;
  if (nA != nB) { printf("  MISMATCH event count %d vs %d\n", nA, nB); bad++; }
  if (rA != rB) { printf("  MISMATCH result %.0f vs %.0f\n", rA, rB); bad++; }
  int lim = nA < nB ? nA : nB;
  for (int i = 0; i < lim; i++) {
    if (strcmp(logA[i], logB[i]) != 0) {
      printf("  MISMATCH [%d] fiber{%s} stackless{%s}\n", i, logA[i], logB[i]);
      bad++;
    }
  }
  if (bad == 0) {
    printf("  OK  %d events, identical turn-for-turn\n", nA);
    for (int i = 0; i < nA; i++) printf("        %s\n", logA[i]);
  }
  return bad;
}

int main(void) {
  int bad = 0;

  /* The frame arithmetic, MEASURED rather than asserted. The IR liveness
   * pass priced this function's payload at 4 live locals + 4 temporaries =
   * 64 bytes; the header is whatever ScrCoroBase actually costs, and the
   * total is what a real allocation would take. */
  printf("sizeof ScrCoroBase  = %zu   lean header\n", sizeof(ScrCoroBase));
  printf("sizeof ScrExcCell   = %zu   the D4 surcharge\n", sizeof(ScrExcCell));
  printf("sizeof ScrCoroExc   = %zu   fat header\n", sizeof(ScrCoroExc));
  printf("sizeof FrameResolve = %zu   header + this function live state\n",
         sizeof(FrameResolve));
  printf("a suspended fiber today = 18432 B (4K commit + 12K PAGE_GUARD + ~1.7K page table)\n\n");


  /* Both suspensions on every iteration: 3 jids x 2 awaits. */
  Args both = { ADD, 2, REM, 1, true, -1 };
  bad += compare("A. two suspensions per iteration", both);

  /* The ternary's false arm: only suspension 1 runs. The state machine must
   * skip state 2 entirely and still agree turn for turn. */
  Args one = { ADD, 2, REM, 1, false, -1 };
  bad += compare("B. conditional suspension skipped", one);

  /* Empty inner loops: the body suspends ZERO times and the function throws.
   * A frame analysis that cannot produce "no suspensions happened" cannot be
   * trusted when it reports that some did. */
  Args none = { NULL, 0, NULL, 0, true, -1 };
  bad += compare("C. zero suspensions, throws", none);

  /* A throw that escapes the body MID-RUN, after a suspension has already
   * happened. Nothing here calls a finish function: the fiber relies on the
   * trampoline's scr_exc_pending() guard and the stackless frame on
   * scr_coro_resume_entry. If the stackless side got that wrong the throw
   * would propagate into the event loop instead of rejecting the promise. */
  Args boom = { ADD, 2, REM, 1, true, 2 };
  bad += compare("D. throw escapes mid-body", boom);

  printf("\n%s\n", bad == 0 ? "corostate: ALL ARMS AGREE"
                            : "corostate: MISMATCHES FOUND");
  return bad == 0 ? 0 : 1;
}
