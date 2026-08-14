/* AbortController / AbortSignal — the fetch-cancellation slice's handles.
 *
 * The unit began as forty lines of pure refcount, because the shape that
 * appears first in real code is an OPTIONAL FIELD on an options record
 * that the program never reads:
 *
 *     interface FetchInput { readonly url: string; readonly signal?: AbortSignal }
 *
 * With no representation at all, that record does not compile, nor does
 * any record holding it, nor any class holding one of those. Giving the
 * handle a type ended that chain; this file is the VALUE surface that
 * ends the next one — the seven operations a program that actually
 * cancels something needs: construct a controller, abort it with a
 * reason, read its signal, and on the signal read `aborted`, read
 * `reason`, add an 'abort' listener, remove one.
 *
 * Two things about the shape are deliberate and load-bearing.
 *
 * BOTH handles carry a cycle header. A refcount alone leaks the canonical
 * program:
 *
 *     const onAbort = () => controller.abort(signal.reason)
 *     signal.addEventListener('abort', onAbort, { once: true })
 *
 * The closure captures the signal; the signal stores the closure. That is
 * signal -> closure -> signal, written on purpose by ordinary code, and
 * the controller joins it whenever the captured name is the controller
 * rather than its signal. So the listener vector is a TRACED edge and the
 * controller's signal edge is traced too. The `reason` is NOT traced: no
 * ScrDyn tracing exists anywhere in the runtime, so a cycle that runs
 * through a reason payload is merely never collected — the same standing
 * limitation the dyn->closure edge already has.
 *
 * The listener vector is the ScrNetLs SHAPE, not the ScrNetLs unit: a
 * flat array of {closure, once} entries. It adds two things that family
 * does not have — the identity-keyed remove removeEventListener needs
 * (EventTarget keys its set on (type, callback, capture), which is also
 * why a repeat add of the same callback is not a second listener), and a
 * dispatch that survives being mutated by its own listeners in the four
 * ways Node allows. See scr_abort_fire. */
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "scr_runtime.h"

typedef struct ScrAbortL {
  ScrClosure *cb; /* owned; TRACED (the capture cycle above) */
  bool once;
  /* Registration order, monotonic and never reused. The dispatch walks by
   * this rather than by array index, because the array is allowed to move
   * under it: a listener may add or remove listeners while the pass is
   * running, and Node's answers to those cases are what the sequence
   * numbers reproduce. See scr_abort_fire. */
  uint64_t seq;
} ScrAbortL;

struct ScrAbortSignal {
  size_t rc;
  bool aborted;
  /* The abort reason, owned, NULL until aborted. A ScrDyn because
   * `reason` is `any` in the lib and Node preserves the value it was
   * given IDENTICALLY — `c.abort(err)` leaves `signal.reason === err`
   * with `.code` intact. scr_dyn_from_error keeps an identity cache
   * keyed on the ScrError, so the Error->dyn crossing is stable and the
   * `code` slot crosses with it; rebuilding an Error from `.message`
   * would silently drop `code`, which is exactly the failure that kept
   * destroy(err) fenced elsewhere. */
  ScrDyn *reason;
  ScrAbortL *ls;
  size_t n, cap;
  uint64_t next_seq;
};

struct ScrAbortController {
  size_t rc;
  ScrAbortSignal *sig; /* owned, never NULL; TRACED */
};

static void scr_abort_oom(void) { scr_trap("scriptc: out of memory\n"); }

/* ── the signal ─────────────────────────────────────────────────────── */

static void scr_abort_signal_trace(void *obj, ScrTraceVisit visit, void *ctx) {
  ScrAbortSignal *s = obj;
  for (size_t i = 0; i < s->n; i++) visit(s->ls[i].cb, ctx);
}

/* Collector teardown: the complement of the trace — frees the vector but
 * does NOT release the closures (those edges were already accounted by
 * markGray), and releases the untraced reason. */
static void scr_abort_signal_gcfree(void *obj) {
  ScrAbortSignal *s = obj;
  free(s->ls);
  scr_dyn_release(s->reason);
  scr_abortsig_free_note();
  scr_cyc_free(s);
}

ScrAbortSignal *scr_abort_signal_new(void) {
  ScrAbortSignal *s =
      scr_cyc_alloc(sizeof *s, &scr_abort_signal_trace, &scr_abort_signal_gcfree);
  s->rc = 1;
  scr_abortsig_alloc_note();
  return s;
}

ScrAbortSignal *scr_abort_signal_retain(ScrAbortSignal *s) {
  if (s && s->rc != SIZE_MAX) {
    s->rc++;
    scr_cyc_mark_live(s);
  }
  return s;
}

void scr_abort_signal_release(ScrAbortSignal *s) {
  if (!s || s->rc == SIZE_MAX) return;
  if (--s->rc == 0) {
    scr_cyc_on_dead(s);
    for (size_t i = 0; i < s->n; i++) scr_closure_release(s->ls[i].cb);
    free(s->ls);
    scr_dyn_release(s->reason);
    scr_abortsig_free_note();
    scr_cyc_free(s);
  } else {
    scr_cyc_on_release(s); /* possible cycle root; may collect */
  }
}

void *scr_abort_signal_retain_v(void *p) { return scr_abort_signal_retain((ScrAbortSignal *)p); }
void scr_abort_signal_release_v(void *p) { scr_abort_signal_release((ScrAbortSignal *)p); }
void scr_abort_signal_trace_v(void *p, ScrTraceVisit visit, void *ctx) {
  scr_abort_signal_trace(p, visit, ctx);
}

bool scr_abort_signal_aborted(const ScrAbortSignal *s) { return s->aborted; }

/* `signal.reason` — +1. `undefined` before the abort, exactly Node. */
ScrDyn *scr_abort_signal_reason(const ScrAbortSignal *s) {
  return scr_dyn_retain(s->reason ? s->reason : scr_dyn_undefined());
}

/* ── listeners ──────────────────────────────────────────────────────── */

/* EventTarget's listener set is keyed on (type, callback, capture), so a
 * repeat add of the SAME callback is not a second registration — the
 * repeat is ignored outright. Three consequences, each of which was a
 * live bug in the island lane until ddab03f: the listener fires ONCE
 * rather than once per add; it keeps the FIRST add's position in the
 * order, so a later re-add cannot move it down the list; and the
 * repeat's `once` is discarded with the rest of it, so add(f) then
 * add(f,{once:true}) leaves a non-once entry that ONE remove clears.
 *
 * A listener added AFTER the abort is STORED and never fires — there is
 * no second dispatch, because the first abort wins. Storing it is not
 * bookkeeping for its own sake: an add made DURING the dispatch has to
 * land in the list, or Node's "a non-last listener's append still fires"
 * case cannot happen (measured; scr_abort_fire's walk is what reaches
 * it). `cb` MOVES IN. */
void scr_abort_signal_add(ScrAbortSignal *s, ScrClosure *cb, bool once) {
  if (!cb) return;
  for (size_t i = 0; i < s->n; i++) {
    if (s->ls[i].cb == cb) {
      scr_closure_release(cb);
      return;
    }
  }
  if (s->n == s->cap) {
    s->cap = s->cap ? s->cap * 2 : 2;
    s->ls = realloc(s->ls, s->cap * sizeof *s->ls);
    if (!s->ls) scr_abort_oom();
  }
  s->ls[s->n].cb = cb; /* ownership moves in */
  s->ls[s->n].once = once;
  s->ls[s->n].seq = s->next_seq++;
  s->n++;
  /* Nothing is buffered here on purpose. Storing an edge never makes an
   * object a candidate root — the cycle it closes becomes visible when
   * the LAST external reference to the signal is released, and that
   * release runs scr_cyc_on_release below. Buffering on add would only
   * add a root that scan() re-blackens. */
}

/* removeEventListener by CALLBACK IDENTITY. The listener is a RETAINED
 * reference and this is the release: a remove that only forgot the entry
 * would keep the closure (and everything it captured) alive forever,
 * which on the capture cycle above means the signal too. */
void scr_abort_signal_off(ScrAbortSignal *s, ScrClosure *cb) {
  if (!cb) return;
  /* A remove that lands DURING a dispatch takes effect immediately: the
   * walk finds entries by sequence number in the LIVE array, so a removed
   * listener is simply not there when its turn comes (Node skips a
   * listener another listener removed — measured).  */
  for (size_t i = 0; i < s->n; i++) {
    if (s->ls[i].cb != cb) continue;
    scr_closure_release(s->ls[i].cb);
    for (size_t j = i + 1; j < s->n; j++) s->ls[j - 1] = s->ls[j];
    s->n--;
    return;
  }
}

/* ── abort ──────────────────────────────────────────────────────────── */

/* The default reason: a DOMException named AbortError carrying the WebIDL
 * legacy code 20 (already in scr_domex_codes[]) and Node's message. Built
 * as a VALUE — scr_throw_domex would throw it. */
static ScrDyn *scr_abort_default_reason(void) {
  ScrDomException *d = (ScrDomException *)scr_domex_alloc();
  d->name = scr_str_new("AbortError", 10);
  d->message = scr_str_new("This operation was aborted", 26);
  d->dom_code = scr_domex_code_of(d->name);
  ScrDyn *r = scr_dyn_from_error((ScrError *)d);
  scr_error_release((ScrError *)d);
  return r;
}

/* Fires the 'abort' event.
 *
 * The dispatch walks the LIVE listener list, and that is measured against
 * Node v25.9.0 rather than taken from the spec. WHATWG says to dispatch
 * over a COPY of the listener list; Node walks its linked list and reads
 * each node's `next` BEFORE invoking that node. The two disagree exactly
 * when a listener mutates the list, and all four cases are observable:
 *
 *   add from a NON-last listener   -> the new listener DOES fire (Node)
 *   add from the LAST listener     -> it does NOT (next was already null)
 *   remove another listener        -> the removed one does NOT fire
 *   a `once` in the MIDDLE          -> the ones after it still fire
 *
 * A copy gets the first wrong; a naive live index walk gets the second
 * wrong. So entries carry a monotonic SEQUENCE number and the walk reads
 * its "next" seq before each call: everything present at that moment with
 * a higher seq is still ahead, anything removed since is simply not found
 * when its turn comes, and anything appended after the captured next ends
 * the walk exactly as Node's null `next` does.
 *
 * `once` entries leave the list BEFORE their own callback runs, like
 * EventTarget.
 *
 * A THROWING listener does not stop the others. What happens to the error
 * afterwards is a MEASURED DIVERGENCE, recorded here rather than left to
 * be discovered: Node reports it through
 * `process.nextTick(() => { throw err; })`, so abort() returns normally,
 * the rest of the current tick runs, and the process dies with that error
 * at the next checkpoint. Here the FIRST error is reported as UNCAUGHT
 * the moment the pass ends -- stdout flushed, the error on stderr, exit 1.
 * Same ultimate outcome and the same exit code; what is lost is whatever
 * the current tick would have printed after abort() returned. The
 * alternative considered and rejected was rethrowing SYNCHRONOUSLY, which
 * IS catchable: a program wrapping abort() in try/catch would then
 * continue and exit 0 where Node exits 1 -- a quiet wrong answer instead
 * of a loud partial one. Matching Node exactly wants a deferred report
 * carrying a payload, which the raw next-tick primitive cannot do today
 * (it takes no context pointer) and which would drag the event loop into
 * otherwise loop-free programs.
 *
 * `s` is borrowed and kept alive by the caller. */
static const uint64_t SCR_ABORT_SEQ_END = (uint64_t)-1;

/* The smallest sequence number present that is >= `from`, or the END
 * sentinel. Linear over a list that is a handful of entries in every
 * program anyone writes. */
static uint64_t scr_abort_seq_at_or_after(const ScrAbortSignal *s, uint64_t from) {
  uint64_t best = SCR_ABORT_SEQ_END;
  for (size_t i = 0; i < s->n; i++) {
    if (s->ls[i].seq >= from && s->ls[i].seq < best) best = s->ls[i].seq;
  }
  return best;
}

static void scr_abort_fire(ScrAbortSignal *s) {
  ScrCaught *first = NULL;
  uint64_t cur = 0;
  for (;;) {
    uint64_t seq = scr_abort_seq_at_or_after(s, cur);
    if (seq == SCR_ABORT_SEQ_END) break;
    size_t idx = 0;
    while (idx < s->n && s->ls[idx].seq != seq) idx++;
    if (idx == s->n) break; /* unreachable; keeps the index honest */
    ScrClosure *cb = scr_closure_retain(s->ls[idx].cb);
    if (s->ls[idx].once) {
      /* Out of the live list BEFORE the call, EventTarget's order. */
      scr_closure_release(s->ls[idx].cb);
      for (size_t j = idx + 1; j < s->n; j++) s->ls[j - 1] = s->ls[j];
      s->n--;
    }
    /* Node reads `next` before invoking: an append made by THIS callback
     * lands after the captured position and is therefore not visited when
     * this was the last entry. */
    uint64_t next = seq == SCR_ABORT_SEQ_END ? SCR_ABORT_SEQ_END
                                             : scr_abort_seq_at_or_after(s, seq + 1);
    ((void (*)(ScrClosure *))cb->fn)(cb);
    if (scr_exc_pending()) {
      ScrCaught *c = scr_exc_take();
      if (first == NULL) first = c;
      else scr_caught_release(c);
    }
    scr_closure_release(cb);
    if (next == SCR_ABORT_SEQ_END) break;
    cur = next;
  }
  if (first != NULL) {
    scr_rethrow(first);
    scr_caught_release(first);
    scr_exc_print_uncaught();
    _Exit(1);
  }
}

/* The FIRST abort wins: a second one is a NO-OP and does not change the
 * reason — which is also what makes abort()-after-the-operation-completed
 * a no-op rather than a late rejection. `reason` is BORROWED; NULL or the
 * dyn undefined means "no reason given" and mints the AbortError. */
void scr_abort_signal_abort(ScrAbortSignal *s, ScrDyn *reason) {
  if (s->aborted) return;
  s->aborted = true;
  s->reason = (reason == NULL || reason->kind == SCR_DYN_UNDEF)
                  ? scr_abort_default_reason()
                  : scr_dyn_retain(reason);
  scr_abort_fire(s);
}

/* ── the controller ─────────────────────────────────────────────────── */

static void scr_abort_ctl_trace(void *obj, ScrTraceVisit visit, void *ctx) {
  visit(((ScrAbortController *)obj)->sig, ctx);
}

static void scr_abort_ctl_gcfree(void *obj) {
  scr_abortctl_free_note();
  scr_cyc_free(obj);
}

ScrAbortController *scr_abort_controller_new(void) {
  ScrAbortController *c =
      scr_cyc_alloc(sizeof *c, &scr_abort_ctl_trace, &scr_abort_ctl_gcfree);
  c->rc = 1;
  c->sig = scr_abort_signal_new();
  scr_abortctl_alloc_note();
  return c;
}

ScrAbortController *scr_abort_controller_retain(ScrAbortController *c) {
  if (c && c->rc != SIZE_MAX) {
    c->rc++;
    scr_cyc_mark_live(c);
  }
  return c;
}

void scr_abort_controller_release(ScrAbortController *c) {
  if (!c || c->rc == SIZE_MAX) return;
  if (--c->rc == 0) {
    scr_cyc_on_dead(c);
    scr_abort_signal_release(c->sig);
    scr_abortctl_free_note();
    scr_cyc_free(c);
  } else {
    scr_cyc_on_release(c);
  }
}

void *scr_abort_controller_retain_v(void *p) {
  return scr_abort_controller_retain((ScrAbortController *)p);
}
void scr_abort_controller_release_v(void *p) {
  scr_abort_controller_release((ScrAbortController *)p);
}
void scr_abort_controller_trace_v(void *p, ScrTraceVisit visit, void *ctx) {
  scr_abort_ctl_trace(p, visit, ctx);
}

/* `controller.signal` — ONE signal per controller, stable identity across
 * every read (Node's getter answers the same object). +1. */
ScrAbortSignal *scr_abort_controller_signal(ScrAbortController *c) {
  return scr_abort_signal_retain(c->sig);
}

void scr_abort_controller_abort(ScrAbortController *c, ScrDyn *reason) {
  scr_abort_signal_abort(c->sig, reason);
}
