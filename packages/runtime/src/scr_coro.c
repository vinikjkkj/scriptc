/* Stackless coroutine frames -- see scr_coro.h for the design and for why
 * the promise WAITER list is the attach point rather than the cbs list.
 *
 * This file is deliberately small. The scheduler, the microtask queue, the
 * promise settle path and the uncaught/unhandled ledgers all stay exactly as
 * they are; a coroutine is an awaiter that happens not to own a stack, and
 * everything here is about making it indistinguishable from a fiber at the
 * two places that can observe the difference:
 *
 *   1. TURN ACCOUNTING -- scr_coro_park, which charges exactly one
 *      scr_ready_push per await on exactly one of its two arms.
 *   2. PER-TASK STATE -- scr_coro_resume_entry, which saves and restores the
 *      AsyncLocalStorage context and (for a fat frame) the exception cell.
 *      scr_switch did both for free on every fiber switch; a state machine
 *      does neither, and nothing else in the runtime will notice it missing.
 *      This is the quiet one, and it is why resume_entry brackets the body
 *      instead of the generated code doing it at each resume site.
 */
#include "scr_coro.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void scr_coro_oom(void) {
  fputs("scriptc: out of memory allocating a coroutine frame\n", stderr);
  abort();
}

ScrExcCell *scr_coro_exc(ScrCoroBase *base) {
  if (base == NULL || (base->flags & SCR_CORO_HAS_EXC) == 0) return NULL;
  return &((ScrCoroExc *)base)->exc;
}

void scr_coro_init(ScrCoroBase *base, ScrCoroResume resume, ScrPromise *promise,
                   bool has_exc) {
  base->resume = resume;
  base->promise = promise; /* the caller's +1 moves in */
  /* Node's init-time capture: a spawned task runs in the SPAWNER's ALS
   * context, which is what scr_async_spawn does with f->als. Snapshots are
   * immutable, so a retain is the whole copy. */
  base->als = scr_als_ctx_retain(*scr_als_active);
  base->state = 0;
  base->flags = has_exc ? SCR_CORO_HAS_EXC : 0u;
  base->rc = 1;
  if (has_exc) {
    /* SCR_EXC_NONE is 0, so a zeroed cell is a valid empty cell. */
    memset(&((ScrCoroExc *)base)->exc, 0, sizeof(ScrExcCell));
  }
}

ScrCoroBase *scr_coro_retain(ScrCoroBase *base) {
  if (base != NULL) base->rc++;
  return base;
}

void scr_coro_release(ScrCoroBase *base) {
  if (base == NULL || --base->rc != 0) return;
  if (base->promise != NULL) scr_promise_release(base->promise);
  scr_als_ctx_release(base->als);
  free(base);
}

/* ── spawn ───────────────────────────────────────── */

void *scr_coro_alloc(size_t size, ScrCoroResume resume, bool has_exc) {
  /* calloc, not malloc: generated code assigns only the fields it uses, and
   * a frame's unassigned pointer slots must be NULL for the death path to be
   * able to release them unconditionally. */
  ScrCoroBase *base = (ScrCoroBase *)calloc(1, size);
  if (base == NULL) scr_coro_oom();
  scr_coro_init(base, resume, scr_promise_new(), has_exc);
  return base;
}

ScrPromise *scr_coro_spawn(ScrCoroBase *base) {
  /* Retained BEFORE the body runs. A body that completes (or throws) without
   * ever suspending drops the frame's last reference inside resume_entry and
   * frees it, taking its promise reference with it -- scr_async_spawn retains
   * for exactly this reason before it may destroy the fiber. */
  ScrPromise *p = scr_promise_retain(base->promise);
  scr_coro_resume_entry(base);
  return p;
}

/* ── suspension ───────────────────────────────────────────────────────── */

ScrCoroParkKind scr_coro_park(ScrCoroBase *base, ScrPromise *p) {
  /* Set BEFORE either arm: scr_coro_resume_entry reads this after the body
   * returns to tell a park from a fall-out-of-the-body, and the two need
   * opposite handling. */
  base->flags |= SCR_CORO_SUSPENDED;

  /* The suspension owns a reference: between here and the resume, the only
   * things naming this frame are the ready queue or a promise waiter list,
   * and neither of them is a strong edge on its own. */
  scr_coro_retain(base);

  /* ARM 1 -- pending operand. Zero pushes now. The frame goes on the
   * promise's existing waiter list, and scr_promise_settle_wake's
   * `for (i) scr_ready_push(p->waiters[i])` pushes it exactly once, for a
   * fulfilment or a rejection alike. No new push site is introduced, which
   * is what keeps "one push per await" countable against the four that
   * exist in scr_async.c. */
  if (scr_coro_promise_park(p, &scr_coro_resume_entry, base, NULL)) {
    return SCR_CORO_PARK_PENDING;
  }

  /* ARM 2 -- already-settled operand. JS's await still yields exactly one
   * microtask turn, so the hop is charged HERE and now. This is the
   * stackless twin of scr_await_settled's
   *     if (p->state != SCR_PROM_PENDING) scr_await_yield();
   * and scr_queue_microtask_raw performs exactly one scr_ready_push. */
#ifdef SCR_CORO_POISON_SKIP_HOP
  /* DELIBERATE FAULT, test-only: resume inline instead of enqueueing. This
   * is precisely what attaching the resume to the promise's `cbs` list would
   * do -- consume zero microtask turns and run one turn early. It exists so
   * the turn-comparison test can be shown to FAIL when the invariant is
   * broken; a comparison that has never gone red is not evidence. */
  scr_coro_resume_entry(base);
  return SCR_CORO_PARK_HOP;
#else
  scr_queue_microtask_raw(&scr_coro_resume_entry, base, NULL);
  return SCR_CORO_PARK_HOP;
#endif
}

/* ── resumption (INV-5 lives here) ────────────────────────────────────── */

void scr_coro_resume_entry(void *base_as_void) {
  ScrCoroBase *base = (ScrCoroBase *)base_as_void;

  /* INV-5, in. A fiber got both of these from scr_switch; a state machine
   * runs on whatever stack the loop is on, so the per-task state has to be
   * installed explicitly around the body.
   *
   * ALS: unconditional. Every frame has a context, D1 included.
   * Exception cell: only a fat frame owns one. A lean frame deliberately
   * borrows the ambient cell -- it can never be suspended with an exception
   * pending, so there is nothing of its own to preserve across the gap. */
  ScrAlsCtx **prev_als = scr_als_active;
  scr_als_active = &base->als;
  ScrExcCell *mine = scr_coro_exc(base);
  ScrExcCell *prev_cell = (mine != NULL) ? scr_exc_swap_cell(mine) : NULL;

  base->flags &= ~(uint32_t)SCR_CORO_SUSPENDED;
  base->flags |= SCR_CORO_RUNNING;
  base->resume(base);
  base->flags &= ~(uint32_t)SCR_CORO_RUNNING;

  /* The body returned without parking and without finishing: an exception
   * escaped it. The fiber path turns this into a REJECTION inside
   * scr_fiber_finish, and JS requires the same -- an async function that
   * throws before its first await returns a rejected promise, it does not
   * throw at its caller. A LEAN frame borrows the ambient cell, so without
   * this the throw would propagate into whoever resumed us: the spawner on
   * the synchronous prefix, or the loop on a later turn.
   *
   * Checked while the frame's own cell is STILL INSTALLED, because
   * scr_promise_reject_pending reads the ACTIVE cell. */
  if ((base->flags & (SCR_CORO_DONE | SCR_CORO_SUSPENDED)) == 0u) {
    if (scr_exc_pending()) {
      scr_coro_finish_throw(base);
    } else {
      /* Neither parked, nor finished, nor threw. The resume function broke
       * its contract; staying quiet here would settle nothing and leak the
       * frame, so it is loud. */
      fputs("scriptc: internal error: a coroutine resume returned without "
            "suspending, finishing, or throwing\n", stderr);
      abort();
    }
  }

  /* INV-5, out. Restores whatever was active before, which is main's cell on
   * a loop resume and some other frame's when a coroutine resumes inline. */
  if (mine != NULL) (void)scr_exc_swap_cell(prev_cell);
  scr_als_active = prev_als;

  /* The suspension's reference. A frame that finished drops to its last
   * reference here and is freed; one that parked again was retained by the
   * park before this release runs. */
  scr_coro_release(base);
}

/* ── completion ───────────────────────────────────────────────────────── */

void scr_coro_finish_void(ScrCoroBase *base) {
  base->flags |= SCR_CORO_DONE;
  scr_promise_fulfill_void(base->promise);
}

void scr_coro_finish_f64(ScrCoroBase *base, double v) {
  base->flags |= SCR_CORO_DONE;
  scr_promise_fulfill_f64(base->promise, v);
}

void scr_coro_finish_ref(ScrCoroBase *base, void *v, void *(*retain)(void *),
                         void (*release)(void *), ScrTraceFn trace) {
  base->flags |= SCR_CORO_DONE;
  scr_promise_fulfill_ref(base->promise, v, retain, release, trace);
}

void scr_coro_finish_throw(ScrCoroBase *base) {
  base->flags |= SCR_CORO_DONE;
  /* Moves the pending exception out of the active cell and into the promise
   * as a rejection -- the same transition scr_fiber_finish makes. */
  scr_promise_reject_pending(base->promise);
}

/* ── await result extraction ──────────────────────────────────────────── */

/* By the time any of these runs the operand is settled: the frame only got
 * back here through the ready queue, and both park arms lead there after the
 * settlement. They are scr_await_f64 and friends with the parking removed. */

static bool scr_coro_settled_ok(ScrPromise *p) {
  scr_coro_promise_observe(p);
  if (scr_coro_promise_rejected(p)) {
    scr_coro_promise_rethrow(p);
    return false;
  }
  return true;
}

double scr_coro_take_f64(ScrCoroBase *base, ScrPromise *p) {
  (void)base;
  return scr_coro_settled_ok(p) ? scr_coro_promise_f64(p) : 0;
}

bool scr_coro_take_bool(ScrCoroBase *base, ScrPromise *p) {
  (void)base;
  return scr_coro_settled_ok(p) ? scr_coro_promise_bool(p) : false;
}

void *scr_coro_take_ref(ScrCoroBase *base, ScrPromise *p) {
  (void)base;
  return scr_coro_settled_ok(p) ? scr_coro_promise_ref(p) : NULL;
}

void scr_coro_take_void(ScrCoroBase *base, ScrPromise *p) {
  (void)base;
  (void)scr_coro_settled_ok(p);
}
