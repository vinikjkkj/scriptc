/* The timers/promises setInterval async iterator (scr_tp_interval_*): the
 * loop that `for await (const v of tp.setInterval(ms, value, options))`
 * lowers to. Node's generator (lib/timers/promises.js) keeps one Timeout and
 * a counter of ticks not yet yielded; each next() hands out one tick, parking
 * when none is pending, and an abort rejects the parked next() with an
 * AbortError whose cause is the signal's reason. The lowered loop opens the
 * record once at loop entry (Node's first next() creates the Timeout at the
 * same point), calls next() per iteration, and closes it on every exit
 * (break, return, throw, abort), where Node's `finally` clears the interval
 * and removes the abort listener.
 *
 * Handles are the record's address as an f64: user-space addresses are exact
 * in a double. A `refed` false keeps the interval from holding the loop
 * open, exactly as Node's `ref: false` does for the Timeout. The tick path
 * rides scr_set_interval (scr_async.c), so its delay handling is the global
 * setInterval's. Gate: tpValue (the same gate as scr_tp_value.c). */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scr_runtime.h"

typedef struct ScrTpIv {
  double handle;        /* the interval id; 0 when no timer was armed */
  ScrAbortSignal *sig;  /* +1 while held; NULL without an options.signal */
  bool listening;       /* the abort listener is registered on sig */
  ScrPromise *waiter;   /* +1 while a next() is parked; NULL otherwise */
  double notYielded;    /* ticks not yet handed out */
  bool startAborted;    /* the signal was aborted at open: no timer, next() rejects */
  bool failedNext;      /* a next() rejected: the loop's IteratorClose does not call return() */
  bool closed;
} ScrTpIv;

static void scr_tpi_on_abort(void *ctx);

/* The AbortError Node rejects with, into the active exception cell. */
static void scr_tpi_throw_abort(ScrDyn *reason) {
  ScrStr *m = scr_str_new("The operation was aborted", 25);
  ScrError *e = scr_error_new(SCR_ERR_ERROR, m);
  scr_str_release(m);
  scr_str_release(e->name);
  e->name = scr_str_new("AbortError", 10);
  e->code = scr_str_new("ABORT_ERR", 9);
  scr_error_set_cause(e, reason);
  scr_throw_obj(e, scr_error_retain_v, scr_error_release_v, scr_error_trace_arg());
}

/* Drops the native abort listener (once) and nothing else. */
static void scr_tpi_unlisten(ScrTpIv *r) {
  if (!r->listening) return;
  scr_abort_signal_off_native(r->sig, &scr_tpi_on_abort, r);
  r->listening = false;
}

/* The interval fired: count the tick; a parked next() takes it at once. */
static void scr_tpi_tick(ScrClosure *self) {
  ScrTpIv *r = (ScrTpIv *)(uintptr_t)scr_box_get_f64(self->caps[0]);
  if (r->closed) return;
  r->notYielded++;
  if (r->waiter != NULL) {
    ScrPromise *p = r->waiter;
    r->waiter = NULL;
    r->notYielded--;
    scr_promise_fulfill_void(p);
    scr_promise_release(p);
  }
}

/* The abort listener (native, borrowed context). Node's onCancel: clear the
 * interval, and reject a parked next() with the AbortError. Ticks already
 * counted are still handed out by later next() calls, as Node's generator
 * yields them before it checks the signal. */
static void scr_tpi_on_abort(void *ctx) {
  ScrTpIv *r = (ScrTpIv *)ctx;
  if (r->closed) return;
  scr_tpi_unlisten(r);
  if (r->handle != 0) {
    scr_clear_interval(r->handle);
    r->handle = 0;
  }
  if (r->waiter != NULL) {
    ScrPromise *p = r->waiter;
    r->waiter = NULL;
    ScrDyn *reason = scr_abort_signal_reason(r->sig); /* +1 */
    scr_tpi_throw_abort(reason);
    scr_dyn_release(reason);
    scr_promise_reject_pending(p);
    scr_promise_release(p);
  }
}

double scr_tp_interval_open_s(double ms, ScrAbortSignal *sig, bool refed) {
  ScrTpIv *r = calloc(1, sizeof *r);
  if (!r) scr_trap("scriptc: out of memory\n");
  if (sig != NULL && scr_abort_signal_aborted(sig)) {
    /* Node's generator throws before it creates the Timeout: the first
     * next() rejects and nothing is armed. */
    r->sig = scr_abort_signal_retain(sig);
    r->startAborted = true;
    return (double)(uintptr_t)r;
  }
  /* The box carries the record's address as a number: the record is owned by
   * the loop (scr_tp_interval_close), not by the closure. */
  ScrClosure *clo = scr_closure_new((void *)scr_tpi_tick, 1);
  clo->caps[0] = scr_box_new(SCR_BOX_F64);
  scr_box_set_f64(clo->caps[0], (double)(uintptr_t)r);
  r->handle = scr_set_interval(clo, ms);
  if (!refed) scr_timer_unref(r->handle);
  if (sig != NULL) {
    r->sig = scr_abort_signal_retain(sig);
    scr_abort_signal_add_native(sig, &scr_tpi_on_abort, r);
    r->listening = true;
  }
  return (double)(uintptr_t)r;
}

double scr_tp_interval_open(double ms, bool refed) { return scr_tp_interval_open_s(ms, NULL, refed); }

/* One next(): a pending tick is handed out at once; otherwise an aborted
 * signal rejects, and a live loop parks until the next tick or the abort. */
ScrPromise *scr_tp_interval_next(double h) {
  ScrTpIv *r = (ScrTpIv *)(uintptr_t)h;
  ScrPromise *p = scr_promise_new();
  if (r->notYielded > 0) {
    r->notYielded--;
    scr_promise_fulfill_void(p);
    return p;
  }
  if (r->startAborted || (r->sig != NULL && scr_abort_signal_aborted(r->sig))) {
    r->failedNext = true;
    ScrDyn *reason = scr_abort_signal_reason(r->sig); /* +1 */
    scr_tpi_throw_abort(reason);
    scr_dyn_release(reason);
    scr_promise_reject_pending(p);
    return p;
  }
  r->waiter = scr_promise_retain(p);
  return p;
}

/* Node's finally: clear the interval, remove the listener, drop the signal. */
void scr_tp_interval_close(double h) {
  ScrTpIv *r = (ScrTpIv *)(uintptr_t)h;
  if (r->closed) return;
  r->closed = true;
  if (r->handle != 0) {
    scr_clear_interval(r->handle);
    r->handle = 0;
  }
  scr_tpi_unlisten(r);
  if (r->waiter != NULL) {
    scr_promise_release(r->waiter);
    r->waiter = NULL;
  }
  if (r->sig != NULL) scr_abort_signal_release(r->sig);
  free(r);
}

ScrPromise *scr_tp_interval_close_p(double h) {
  scr_tp_interval_close(h);
  ScrPromise *p = scr_promise_new();
  scr_promise_fulfill_void(p);
  return p;
}

/* Whether the loop's exit must await IteratorClose: false when the exit is a
 * throw out of next() (Node never calls return() on a generator that threw). */
bool scr_tp_interval_await_close(double h) {
  ScrTpIv *r = (ScrTpIv *)(uintptr_t)h;
  return !r->failedNext;
}
