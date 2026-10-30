/* The timers/promises value/options entry (scr_tp_set_timeout_v): the
 * promise carries the value, the options' signal cancels the wait, and
 * the delay warnings ride the user tick queue. Its own unit so that an
 * AbortSignal-only program never links the dyn-async unit this needs for
 * the warning path; the gate is tpValue, which implies scr_abort.c and
 * scr_async_dyn.c (RUNTIME_UNIT_DEPS). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scr_runtime.h"

/* ── node:timers/promises setTimeout(delay, value, options) ──────────
 * The value/options form (the 1-argument form stays scr_tp_set_timeout in
 * scr_async.c). The promise resolves with the value after the delay; the
 * options' `signal` cancels the wait and `ref: false` keeps the loop from
 * waiting on it. Lives here, behind the abortSignal unit gate, because the
 * signal arm names scr_abort_signal_* and the gate is decided on the IR
 * (lower-builtins routes every value/options call through this entry).
 *
 * Node's order (lib/timers/promises.js + lib/internal/timers.js): an
 * already-aborted signal rejects at once and creates no timer, so no delay
 * warning; otherwise the Timeout constructor warns about a bad delay, then
 * the timer is inserted, then the abort listener is attached. A timer
 * firing or an abort settles exactly once and removes the listener.
 *
 * Payload kinds: 0 f64 (num), 1 bool (num != 0), 3 void, 4 ref (val is an
 * owned value, moved into the promise by a fulfill; retain/release/trace
 * are the value type's helpers, exactly as scr_promise_fulfill_ref takes
 * them). A rejection carries an AbortError (name AbortError, code
 * ABORT_ERR, Node's message) whose `cause` is the signal's reason. */

typedef struct ScrTpPend {
  size_t rc;
  ScrPromise *p;       /* +1 while pending; NULL once settled */
  int kind;
  double num;
  void *val;           /* kind 4: owned until it moves into p */
  void *(*retain)(void *);
  void (*release)(void *);
  ScrTraceFn trace;
  double handle;       /* the timer's clear handle */
  ScrAbortSignal *sig; /* +1 while the abort listener is registered */
} ScrTpPend;

static void scr_tp_on_abort(void *ctx);

static void scr_tp_pend_release(ScrTpPend *q) {
  if (--q->rc != 0) return;
  if (q->p) scr_promise_release(q->p);
  if (q->val && q->release) q->release(q->val);
  if (q->sig) scr_abort_signal_release(q->sig);
  free(q);
}

static void *scr_tp_pend_retain_v(void *p) {
  ((ScrTpPend *)p)->rc++;
  return p;
}

static void scr_tp_pend_release_v(void *p) { scr_tp_pend_release((ScrTpPend *)p); }

/* Removes the abort listener (if armed) and drops its signal reference. */
static void scr_tp_disarm(ScrTpPend *q) {
  if (q->sig == NULL) return;
  scr_abort_signal_off_native(q->sig, &scr_tp_on_abort, q);
  scr_abort_signal_release(q->sig);
  q->sig = NULL;
}

/* The AbortError Node rejects with, into the active exception cell (the
 * cell takes the error's +1). `reason` is borrowed: it becomes the cause. */
static void scr_tp_throw_abort(ScrDyn *reason) {
  ScrStr *m = scr_str_new("The operation was aborted", 25);
  ScrError *e = scr_error_new(SCR_ERR_ERROR, m);
  scr_str_release(m);
  scr_str_release(e->name);
  e->name = scr_str_new("AbortError", 10);
  e->code = scr_str_new("ABORT_ERR", 9);
  scr_error_set_cause(e, reason);
  scr_throw_obj(e, scr_error_retain_v, scr_error_release_v, scr_error_trace_arg());
}

/* The timer fired: settle with the value. The box's get is a +1 that this
 * fire releases; the loop releases the closure itself afterwards. */
static void scr_tp_fire(ScrClosure *self) {
  ScrTpPend *q = (ScrTpPend *)scr_box_get_ref(self->caps[0]);
  scr_tp_disarm(q);
  ScrPromise *p = q->p;
  q->p = NULL;
  switch (q->kind) {
    case 0:
      scr_promise_fulfill_f64(p, q->num);
      break;
    case 1:
      scr_promise_fulfill_bool(p, q->num != 0);
      break;
    case 3:
      scr_promise_fulfill_void(p);
      break;
    default:
      scr_promise_fulfill_ref(p, q->val, q->retain, q->release, q->trace);
      q->val = NULL; /* moved into the promise */
      break;
  }
  scr_promise_release(p);
  scr_tp_pend_release(q);
}

/* The abort listener (native, borrowed context). The record is kept alive
 * across the cancel: clearing the timer drops the box's reference. */
static void scr_tp_on_abort(void *ctx) {
  ScrTpPend *q = (ScrTpPend *)ctx;
  q->rc++;
  ScrAbortSignal *s = q->sig; /* +1, released below */
  q->sig = NULL;
  scr_abort_signal_off_native(s, &scr_tp_on_abort, q);
  scr_clear_interval(q->handle);
  ScrDyn *reason = scr_abort_signal_reason(s); /* +1 */
  ScrPromise *p = q->p;
  q->p = NULL;
  scr_tp_throw_abort(reason);
  scr_dyn_release(reason);
  scr_promise_reject_pending(p);
  scr_promise_release(p);
  scr_abort_signal_release(s);
  scr_tp_pend_release(q);
}

ScrPromise *scr_tp_set_timeout_v(double ms, int kind, double num, void *val,
                                 void *(*retain)(void *), void (*release)(void *), ScrTraceFn trace,
                                 ScrAbortSignal *sig, bool refed) {
  ScrPromise *p = scr_promise_new();
  if (sig != NULL && scr_abort_signal_aborted(sig)) {
    ScrDyn *reason = scr_abort_signal_reason(sig); /* +1 */
    scr_tp_throw_abort(reason);
    scr_dyn_release(reason);
    scr_promise_reject_pending(p);
    if (kind == 4 && val != NULL && release != NULL) release(val);
    return p;
  }
  ScrTpPend *q = calloc(1, sizeof *q);
  if (!q) scr_trap("scriptc: out of memory\n");
  q->rc = 1;
  q->p = scr_promise_retain(p);
  q->kind = kind;
  q->num = num;
  q->val = kind == 4 ? val : NULL;
  q->retain = retain;
  q->release = release;
  q->trace = trace;
  ScrClosure *clo = scr_closure_new((void *)scr_tp_fire, 1);
  clo->caps[0] = scr_box_new_obj(scr_tp_pend_retain_v, scr_tp_pend_release_v, NULL);
  scr_box_set_ref(clo->caps[0], q); /* the box owns the record's one reference */
  q->handle = scr_set_timeout_handle(clo, ms);
  if (!refed) scr_timer_unref(q->handle);
  if (sig != NULL) {
    q->sig = scr_abort_signal_retain(sig);
    scr_abort_signal_add_native(sig, &scr_tp_on_abort, q);
  }
  return p;
}
