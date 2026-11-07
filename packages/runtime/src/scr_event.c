/* Event — Node's global `Event`, the value an 'abort' listener receives.
 *
 * The unit is LINK-GATED on moduleUsesEvent (an `event`-typed slot or an
 * evt.* libCall anywhere in the module), and the same gate turns on
 * -DSCR_ABORT_EV for scr_abort.c, whose dispatch builds the Event and
 * honours stopImmediatePropagation only in that variant. A program that
 * never names Event links the unchanged scr_abort.c object.
 *
 * Every number below is measured against Node v24.15.0, not read off the
 * spec: Node's Event is a thin class (lib/internal/event_target.js) and
 * where it differs from WHATWG the difference is the contract.
 *
 *   - `defaultPrevented` is `cancelable && prevented`: initEvent turning
 *     cancelable off makes an already-prevented event read false.
 *   - `preventDefault()` on a non-cancelable event is a no-op.
 *   - `returnValue` is `!cancelable || !prevented`; assigning a falsy value
 *     is preventDefault(), a truthy one does nothing.
 *   - `cancelBubble` is the stop-propagation flag; the setter only ever
 *     raises it. stopImmediatePropagation raises BOTH flags.
 *   - `eventPhase` is AT_TARGET (2) while being dispatched, NONE (0)
 *     otherwise; `composedPath()` is [target] while dispatching and []
 *     otherwise; `currentTarget` is the target while dispatching and null
 *     otherwise; `target`/`srcElement` stay set. "Dispatching" is true
 *     ONLY during the first listener of a dispatch: Node clears the flag
 *     after each listener returns (a throw skips the clear), so the
 *     second listener already sees phase 0, null and [] (measured).
 *   - `isTrusted` is a PROTOTYPE getter over a set of events the runtime
 *     itself dispatched: false for `new Event()`, true for the abort event.
 *   - initEvent(type, bubbles = false, cancelable = false) is a no-op while
 *     dispatching, otherwise rewrites those three; it does NOT reset the
 *     stop or prevented flags.
 *
 * The handle carries a collector header: target/currentTarget are signals
 * (cycle-capable), and a listener may stash the event in a closure the
 * signal owns. The edges are traced. */
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scr_runtime.h"

struct ScrEvent {
  size_t rc;
  ScrStr *type;            /* owned, never NULL */
  ScrAbortSignal *target;  /* owned or NULL; TRACED. currentTarget is `dispatching ? target : null` */
  double timestamp;
  bool bubbles, cancelable, composed, trusted;
  bool prevented, stopped, stopped_imm;
  bool dispatching;
};

static void scr_event_trace(void *obj, ScrTraceVisit visit, void *ctx) {
  ScrEvent *e = obj;
  if (e->target) visit(e->target, ctx);
}

/* Collector teardown: the signal edges were already accounted by markGray,
 * so only the untraced owned string is released. */
static void scr_event_gcfree(void *obj) {
  ScrEvent *e = obj;
  scr_str_release(e->type);
  scr_event_free_note();
  scr_cyc_free(e);
}

/* `type` BORROWED. */
ScrEvent *scr_event_new(ScrStr *type, bool bubbles, bool cancelable, bool composed) {
  ScrEvent *e = scr_cyc_alloc(sizeof *e, &scr_event_trace, &scr_event_gcfree);
  e->rc = 1;
  e->type = scr_str_retain(type);
  e->bubbles = bubbles;
  e->cancelable = cancelable;
  e->composed = composed;
  e->timestamp = scr_perf_now();
  scr_event_alloc_note();
  return e;
}

/* The abort event: trusted, targeting its signal. `dispatching` is false
 * when an earlier listener of the same dispatch already returned (Node
 * clears kIsBeingDispatched after EACH listener call — see
 * scr_event_listener_returned). `sig` is BORROWED (the signal is alive for
 * the whole dispatch). */
ScrEvent *scr_event_new_abort(ScrAbortSignal *sig, bool dispatching) {
  ScrStr *t = scr_str_new("abort", 5);
  ScrEvent *e = scr_event_new(t, false, false, false);
  scr_str_release(t);
  e->trusted = true;
  e->dispatching = dispatching;
  e->target = scr_abort_signal_retain(sig);
  return e;
}

ScrEvent *scr_event_retain(ScrEvent *e) {
  if (e && e->rc != SIZE_MAX) {
    e->rc++;
    scr_cyc_mark_live(e);
  }
  return e;
}

void scr_event_release(ScrEvent *e) {
  if (!e || e->rc == SIZE_MAX) return;
  if (--e->rc == 0) {
    scr_cyc_on_dead(e);
    scr_abort_signal_release(e->target);
    scr_str_release(e->type);
    scr_event_free_note();
    scr_cyc_free(e);
  } else {
    scr_cyc_on_release(e);
  }
}

void *scr_event_retain_v(void *p) { return scr_event_retain((ScrEvent *)p); }
void scr_event_release_v(void *p) { scr_event_release((ScrEvent *)p); }
void scr_event_trace_v(void *p, ScrTraceVisit visit, void *ctx) { scr_event_trace(p, visit, ctx); }

/* Dispatch end, and the per-listener reset: Node's kHybridDispatch sets
 * kIsBeingDispatched = false right after EACH listener callback returns
 * (a throwing callback skips it), so only the FIRST listener of a dispatch
 * observes eventPhase 2, a currentTarget and a one-element composedPath;
 * every later one sees 0, null and []. `target` is never cleared. */
void scr_event_listener_returned(ScrEvent *e) { e->dispatching = false; }
void scr_event_end_dispatch(ScrEvent *e) { e->dispatching = false; }

bool scr_event_stopped_immediate(const ScrEvent *e) { return e->stopped_imm; }

/* ── the members ────────────────────────────────────────────────────── */

ScrStr *scr_event_type(const ScrEvent *e) { return scr_str_retain(e->type); }
bool scr_event_default_prevented(const ScrEvent *e) { return e->cancelable && e->prevented; }
bool scr_event_cancelable(const ScrEvent *e) { return e->cancelable; }
bool scr_event_bubbles(const ScrEvent *e) { return e->bubbles; }
bool scr_event_composed(const ScrEvent *e) { return e->composed; }
bool scr_event_is_trusted(const ScrEvent *e) { return e->trusted; }
double scr_event_timestamp(const ScrEvent *e) { return e->timestamp; }
double scr_event_phase(const ScrEvent *e) { return e->dispatching ? 2.0 : 0.0; }
bool scr_event_cancel_bubble(const ScrEvent *e) { return e->stopped; }
bool scr_event_return_value(const ScrEvent *e) { return !e->cancelable || !e->prevented; }

/* +1 or NULL (the lowering turns NULL into null). */
ScrAbortSignal *scr_event_target(const ScrEvent *e) { return scr_abort_signal_retain(e->target); }
ScrAbortSignal *scr_event_current_target(const ScrEvent *e) {
  return e->dispatching ? scr_abort_signal_retain(e->target) : NULL;
}

bool scr_event_has_target(const ScrEvent *e) { return e->target != NULL; }
bool scr_event_has_current_target(const ScrEvent *e) { return e->dispatching && e->target != NULL; }

ScrArr *scr_event_composed_path(const ScrEvent *e) {
  ScrArr *a = scr_arr_new_ref(&scr_abort_signal_retain_v, &scr_abort_signal_release_v,
                              &scr_abort_signal_trace_v, 1);
  if (e->dispatching && e->target) scr_arr_push_ref(a, scr_abort_signal_retain(e->target));
  return a;
}

void scr_event_prevent_default(ScrEvent *e) {
  if (!e->cancelable) return;
  e->prevented = true;
}
void scr_event_stop_propagation(ScrEvent *e) { e->stopped = true; }
void scr_event_stop_immediate(ScrEvent *e) {
  e->stopped = true;
  e->stopped_imm = true;
}
void scr_event_set_cancel_bubble(ScrEvent *e, bool v) {
  if (v) e->stopped = true;
}
void scr_event_set_return_value(ScrEvent *e, bool v) {
  if (!v) scr_event_prevent_default(e);
}

/* initEvent(type, bubbles, cancelable). `type` BORROWED. */
void scr_event_init(ScrEvent *e, ScrStr *type, bool bubbles, bool cancelable) {
  if (e->dispatching) return;
  ScrStr *old = e->type;
  e->type = scr_str_retain(type);
  scr_str_release(old);
  e->bubbles = bubbles;
  e->cancelable = cancelable;
}

/* The zero-argument initEvent(): Node's ERR_MISSING_ARGS for 'type'. */
void scr_event_missing_type(void) {
  static const char msg[] = "The \"type\" argument must be specified";
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, sizeof msg - 1, "ERR_MISSING_ARGS");
}

/* `new Event()` with no argument. */
ScrEvent *scr_event_new_missing(void) {
  scr_event_missing_type();
  return NULL;
}

/* `new Event('x', options)` over a checked-dynamic options value (a JS
 * caller, or a non-literal options object). validateObject: undefined and
 * null are fine, an object is read for its three booleans, and any other
 * value throws ERR_INVALID_ARG_TYPE with Node's "Received" rendering
 * (typeof + inspect for the primitives). `type` BORROWED, `opts` BORROWED. */
ScrEvent *scr_event_new_dyn(ScrStr *type, const ScrDyn *opts) {
  bool bubbles = false, cancelable = false, composed = false;
  if (opts != NULL && opts->kind != SCR_DYN_UNDEF && opts->kind != SCR_DYN_NULL) {
    if (scr_dyn_typeof_is_object(opts)) {
      const ScrDyn *v;
      if (opts->kind == SCR_DYN_OBJ) {
        if ((v = scr_dyn_obj_get(opts, "bubbles", 7)) != NULL) bubbles = scr_dyn_truthy(v);
        if ((v = scr_dyn_obj_get(opts, "cancelable", 10)) != NULL) cancelable = scr_dyn_truthy(v);
        if ((v = scr_dyn_obj_get(opts, "composed", 8)) != NULL) composed = scr_dyn_truthy(v);
      }
    } else {
      char buf[256], ins[96];
      ScrStr *ty = scr_dyn_typeof(opts);
      const char *rendered = scr_dyn_inspect_lite(opts, ins, sizeof ins);
      int n = snprintf(buf, sizeof buf,
                       "The \"options\" argument must be of type object. Received type %.*s (%s)",
                       (int)ty->len, ty->data, rendered);
      scr_str_release(ty);
      scr_throw_error_msg_code(SCR_ERR_TYPE, buf, (size_t)n, "ERR_INVALID_ARG_TYPE");
      return NULL;
    }
  }
  return scr_event_new(type, bubbles, cancelable, composed);
}
