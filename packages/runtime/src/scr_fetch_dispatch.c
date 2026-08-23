/* fetch's `dispatcher`, honoured — see scr_fetch_dispatch.h for what the
 * oracle does, for the map against scr_ws_dispatch.c, and for the two
 * deliberate divergences. */
#include "scr_fetch_dispatch.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* One delegated hop. It outlives the `dispatch` call whenever the program
 * kept the handler — which is the normal case, since a proxy answers a
 * turn or three later — so it is refcounted and the transfer it drives is
 * held +1 for as long as any handler member is reachable. */
typedef struct FdHop {
  size_t rc;
  ScrFetchXfer *t; /* +1 */
  /* onHeaders/onComplete/onError already ran. undici's own handler is
   * single-shot and a dispatcher that calls twice is a dispatcher bug,
   * not a second response. Only the HEAD is single-shot here: onData may
   * arrive any number of times between the head and the end. */
  bool headed;
  bool settled;
  /* `handler.onConnect(abort)` handed us a way to stop the dispatcher.
   * undici's fetch stores exactly this and calls it when the signal
   * fires; a dispatcher that never called onConnect leaves it NULL and
   * the abort then only fails the transfer. */
  ScrDyn *abort;
} FdHop;

static void fd_free(FdHop *h) {
  if (h->t != NULL) {
    scr_fetch_xfer_release(h->t);
    h->t = NULL;
  }
  scr_dyn_release(h->abort);
  free(h);
}

static FdHop *fd_retain(FdHop *h) {
  if (h != NULL) h->rc++;
  return h;
}

static void fd_release(FdHop *h) {
  if (h == NULL) return;
  if (--h->rc == 0) fd_free(h);
}

static void *fd_retain_v(void *p) { return fd_retain((FdHop *)p); }

/* THE HANDLER'S OWN RELEASE, and the one place that can tell that nobody
 * will ever answer.
 *
 * Every one of the ten handler members holds this hop, so while any of
 * them is reachable an onHeaders or an onError can still arrive and the
 * request has to stay open — a dispatcher that answers three turns later
 * depends on exactly that. When the LAST of them goes, the only reference
 * left is the hop's own, and at that instant the program has dropped every
 * way it had of answering.
 *
 * rc == 1 after the decrement is that instant. The transfer then leaves
 * the registry, silently, because the oracle fires nothing here either:
 * measured on Node v25.9.0, a dispatcher that returns without answering
 * leaves the fetch promise unsettled and the process still exits 0 in
 * 45 ms. Leaving the transfer in the registry instead would be an object
 * the RC audit counts at exit — the failure the ws dispatcher's own
 * corpus program exited 99 on before it was fixed. */
static void fd_release_v(void *p) {
  FdHop *h = (FdHop *)p;
  if (h == NULL) return;
  /* AN EXCEPTION IN FLIGHT IS AN ANSWER NOT YET RECORDED. A dispatcher
   * that THROWS releases the handler on the way out — the emitted callee
   * drops its dyn parameters on the throw path — so the last handler
   * member dies BEFORE fd_dispatch has seen the pending exception and
   * turned it into a rejection. Treating that as "nobody can answer"
   * would settle the transfer a moment before the failure needed it.
   * scr_ws_dispatch.c pays the identical toll one unit over, and it cost
   * that block a corpus row's two events to find. */
  if (h->rc == 2 && !h->settled && !scr_exc_pending()) {
    h->rc = 1;
    h->settled = true;
    scr_fetch_xfer_orphan(h->t);
    return;
  }
  fd_release(h);
}

static FdHop *fd_of(ScrClosure *clo) {
  FdHop *h = (FdHop *)scr_box_get_ref(clo->caps[0]);
  /* scr_box_get_ref answers +1; the closure's own reference outlives this
   * synchronous call, so give the extra one back at once rather than
   * threading a release through every early return below. */
  if (h != NULL) fd_release(h);
  return h;
}

/* ── small dyn helpers ──────────────────────────────────────────────── */

static void fd_set(ScrDyn *obj, const char *k, ScrDyn *v) {
  scr_dyn_obj_set(obj, k, strlen(k), v); /* MOVES v */
}

static void fd_set_str(ScrDyn *obj, const char *k, const char *v, size_t vlen) {
  ScrStr *s = scr_str_new(v, vlen);
  fd_set(obj, k, scr_dyn_new_str(s));
  scr_str_release(s);
}

/* One header name or value out of whatever the dispatcher passed. undici
 * hands raw Buffers; a program is just as likely to hand strings, and the
 * oracle accepts both (measured — a dispatcher answering plain strings
 * produces the identical Response). */
static ScrStr *fd_piece(const ScrDyn *d) {
  if (d == NULL) return NULL;
  if (d->kind == SCR_DYN_STR || d->kind == SCR_DYN_NUM) return scr_dyn_string_coerce(d);
  if (d->kind == SCR_DYN_BYTES) {
    ScrBytes *b = scr_dyn_bytes_unbox(d);
    if (b == NULL) return NULL;
    return scr_str_new((const char *)b->data, b->len);
  }
  return NULL;
}

/* ── the response members ───────────────────────────────────────────── */

/* `onHeaders(statusCode, headers, resume, statusText)`. The headers arrive
 * as ONE flat array of alternating names and values, which is the shape
 * scr_fetch_xfer_head wants, so nothing is reordered or re-cased here: the
 * lowercasing and the ", " joining are the fetch unit's rules and stay in
 * one place. Answers `true`, which is what undici's own handler answers
 * and what a dispatcher written against undici tests for backpressure. */
static ScrDyn *fd_on_headers(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  FdHop *h = fd_of(clo);
  if (h == NULL || h->settled || h->headed || !scr_fetch_xfer_live(h->t)) {
    return scr_dyn_new_bool(true);
  }
  h->headed = true;
  int status = argc > 0 ? (int)scr_dyn_to_number(args[0]) : 0;
  ScrStr *stext = argc > 3 ? fd_piece(args[3]) : NULL;
  ScrArr *raw = scr_arr_new(SCR_ELEM_STR, 8);
  if (argc > 1 && args[1] != NULL) {
    double len = scr_dyn_arr_len(args[1]);
    for (double i = 0; i + 1 < len; i += 2) {
      ScrDyn *kd = scr_dyn_arr_at(args[1], i);
      ScrDyn *vd = scr_dyn_arr_at(args[1], i + 1);
      ScrStr *k = fd_piece(kd);
      ScrStr *v = fd_piece(vd);
      scr_dyn_release(kd);
      scr_dyn_release(vd);
      if (k != NULL && v != NULL) {
        scr_arr_push_ref(raw, k);
        scr_arr_push_ref(raw, v);
      } else {
        scr_str_release(k);
        scr_str_release(v);
      }
    }
  }
  scr_fetch_xfer_head(h->t, status, stext, raw); /* both MOVE in */
  return scr_dyn_new_bool(true);
}

static ScrDyn *fd_on_data(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  FdHop *h = fd_of(clo);
  if (h == NULL || h->settled || !scr_fetch_xfer_live(h->t)) return scr_dyn_new_bool(true);
  if (argc > 0 && args[0] != NULL) {
    if (args[0]->kind == SCR_DYN_BYTES) {
      ScrBytes *b = scr_dyn_bytes_unbox(args[0]);
      if (b != NULL) scr_fetch_xfer_data(h->t, b->data, b->len);
    } else {
      /* A string chunk. The oracle takes one (measured) and puts its
       * bytes in the body unchanged. */
      ScrStr *s = fd_piece(args[0]);
      if (s != NULL) {
        scr_fetch_xfer_data(h->t, (const uint8_t *)s->data, s->len);
        scr_str_release(s);
      }
    }
  }
  return scr_dyn_new_bool(true);
}

static ScrDyn *fd_on_complete(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)args;
  (void)argc;
  FdHop *h = fd_of(clo);
  if (h == NULL || h->settled) return scr_dyn_undefined();
  h->settled = true;
  /* A complete with no head is a dispatcher bug — the oracle CRASHES on
   * it, inside undici, reading `this.body.push` off null. Ending a
   * transfer that never got a head would leave the fetch promise
   * unsettled forever, so it is failed instead: loud, and the only
   * direction that cannot be mistaken for a response. */
  if (!h->headed) {
    scr_fetch_xfer_fail(h->t, "UND_ERR_DISPATCH");
    return scr_dyn_undefined();
  }
  scr_fetch_xfer_end(h->t);
  return scr_dyn_undefined();
}

/* `onError(err)`. Node's shape for a dispatcher failure is the ordinary
 * network-failure shape — a TypeError whose message is exactly "fetch
 * failed", with the dispatcher's own error on `cause` — measured both
 * before and after the head. `cause` has no ScrError slot, which is the
 * divergence scr_fetch_static.c's header already records for every
 * dialled failure; the rejection still happens and still carries the
 * code. */
static ScrDyn *fd_on_error(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)args;
  (void)argc;
  FdHop *h = fd_of(clo);
  if (h == NULL || h->settled) return scr_dyn_undefined();
  h->settled = true;
  scr_fetch_xfer_fail(h->t, "UND_ERR_DISPATCH");
  return scr_dyn_undefined();
}

/* `onConnect(abort)`. The one "inert" member that is not: the argument is
 * the dispatcher's own way of being told to stop, and undici's fetch
 * stores it exactly here and calls it when the signal fires. */
static ScrDyn *fd_on_connect(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  FdHop *h = fd_of(clo);
  if (h == NULL) return scr_dyn_undefined();
  if (argc > 0 && args[0] != NULL && args[0]->kind == SCR_DYN_FUNC) {
    scr_dyn_release(h->abort);
    h->abort = scr_dyn_retain(args[0]);
  }
  return scr_dyn_undefined();
}

/* onResponseStarted / onRequestUpgrade / onUpgrade. They exist because the
 * ORACLE's handler has them and a dispatcher written against undici calls
 * them; for a plain request none carries information this transfer needs.
 * Present and inert beats absent: a dispatcher that calls
 * `handler.onResponseStarted()` must not meet "not a function". */
static ScrDyn *fd_nop(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  (void)args;
  (void)argc;
  return scr_dyn_undefined();
}

/* ── the handler and the request options ────────────────────────────── */

/* `sig` is NOT decoration and it must never be a typeKey: the emitted
 * dynCheck for a function type does an exact-signature strcmp and UNWRAPS
 * the closure on a match, calling `clo->fn` through the STATIC C
 * signature. These closures carry the dyn THUNK in `fn`, so that would be
 * a call through the wrong signature. A human-readable spelling can never
 * collide with a typeKey — scr_stream.c's and scr_ws_dispatch.c's
 * convention — and it forces the per-target adapter every time. (A NULL
 * sig is worse still: it segfaults inside that strcmp, in emitted code,
 * naming nothing.) */
static ScrDyn *fd_fn(FdHop *h, ScrDynThunk t, uint32_t arity, const char *sig, const char *name) {
  ScrClosure *c = scr_closure_new((void *)t, 1);
  c->caps[0] = scr_box_new_obj(&fd_retain_v, &fd_release_v, NULL);
  scr_box_set_ref(c->caps[0], fd_retain(h));
  return scr_dyn_new_func(c, t, arity, sig, name);
}

/* The ten-member handler, in the oracle's own property order and with the
 * oracle's own arities. MEASURED against Node v25.9.0 — including that
 * `body` and `abort` are null VALUES rather than functions, that
 * onComplete's arity is 0 although it is called with the trailers, and
 * that this is byte for byte the same ten members the WebSocket path is
 * handed. */
static ScrDyn *fd_handler(FdHop *h) {
  ScrDyn *o = scr_dyn_new_obj();
  fd_set(o, "body", scr_dyn_new_null());
  fd_set(o, "abort", scr_dyn_new_null());
  fd_set(o, "onConnect", fd_fn(h, &fd_on_connect, 1, "(abort)", "onConnect"));
  fd_set(o, "onResponseStarted", fd_fn(h, &fd_nop, 0, "()", "onResponseStarted"));
  fd_set(o, "onHeaders",
         fd_fn(h, &fd_on_headers, 4, "(statusCode,headers,resume,statusText)", "onHeaders"));
  fd_set(o, "onData", fd_fn(h, &fd_on_data, 1, "(chunk)", "onData"));
  fd_set(o, "onComplete", fd_fn(h, &fd_on_complete, 0, "(trailers)", "onComplete"));
  fd_set(o, "onError", fd_fn(h, &fd_on_error, 1, "(err)", "onError"));
  fd_set(o, "onRequestUpgrade",
         fd_fn(h, &fd_nop, 4, "(controller,statusCode,headers,socket)", "onRequestUpgrade"));
  fd_set(o, "onUpgrade", fd_fn(h, &fd_nop, 3, "(statusCode,headers,socket)", "onUpgrade"));
  return o;
}

/* `opts`, in the oracle's key order and with the oracle's own values.
 * MEASURED, including that `upgrade` is PRESENT and undefined for a plain
 * request (the WebSocket path is the one that spells "websocket" there),
 * that `maxRedirections` is 0 because fetch follows redirects itself
 * through the dispatcher, and that `path` is pathname+search.
 *
 * `header_pairs` is the request head scr_fetch_static.c already built,
 * minus host and connection: those are the dialled connection's own
 * fields and the oracle's opts.headers carries neither. */
static ScrDyn *fd_opts(const ScrStr *origin, const ScrStr *path, const ScrStr *method,
                       ScrArr *header_pairs) {
  ScrDyn *o = scr_dyn_new_obj();
  fd_set_str(o, "path", path->len > 0 ? path->data : "/", path->len > 0 ? path->len : 1);
  fd_set_str(o, "origin", origin->data, origin->len);
  fd_set_str(o, "method", method->data, method->len);
  /* NULL, always: a request WITH a body never reaches here — the fetch
   * unit refuses that combination at the call, because opts.body is an
   * async generator in the oracle and every substitute this runtime could
   * put there is a body the dispatcher misreads in silence. */
  fd_set(o, "body", scr_dyn_new_null());
  ScrDyn *hd = scr_dyn_new_obj();
  size_t n = (size_t)scr_arr_len(header_pairs);
  for (size_t i = 0; i + 1 < n; i += 2) {
    ScrStr *k = (ScrStr *)scr_arr_get_ref(header_pairs, (double)i);
    ScrStr *v = (ScrStr *)scr_arr_get_ref(header_pairs, (double)(i + 1));
    ScrDyn *vs = scr_dyn_new_str(v);
    scr_dyn_obj_set(hd, k->data, k->len, vs);
    scr_str_release(k);
    scr_str_release(v);
  }
  fd_set(o, "headers", hd);
  fd_set(o, "maxRedirections", scr_dyn_new_num(0));
  fd_set(o, "upgrade", scr_dyn_undefined());
  return o;
}

/* ── the delegation ─────────────────────────────────────────────────── */

static void fd_hop(ScrFetchXfer *t, ScrStr *origin, ScrStr *path, ScrStr *method,
                   ScrArr *header_pairs, ScrClosure *dispatch, int call_kind, int ret_kind) {
  FdHop *h = calloc(1, sizeof *h);
  if (h == NULL) {
    scr_fetch_xfer_fail(t, "UND_ERR_DISPATCH");
    return;
  }
  h->rc = 1;
  h->t = scr_fetch_xfer_retain(t);
  /* The transfer keeps a reference so the signal listener can reach this
   * hop; it drops it at settle, and a redirect's new hop replaces it. */
  scr_fetch_xfer_set_hop(t, fd_retain(h), (void (*)(void *)) & fd_release);

  ScrDyn *opts = fd_opts(origin, path, method, header_pairs);
  ScrDyn *handler = fd_handler(h);

  /* THE CALL. Both arguments MOVE IN: a dyn parameter is released by the
   * callee, which is read off the emitted C rather than assumed, so
   * nothing here releases them afterwards. The C signature is the arm the
   * COMPILER proved (fetchDispatcherPlan) — a closure called through the
   * wrong signature is undefined behaviour, not a diagnosable failure, so
   * this unit never guesses it. */
  ScrClosure *fn = scr_closure_retain(dispatch);
  if (call_kind == SCR_FD_CALL_REST) {
    ScrDyn *argv = scr_dyn_new_arr();
    scr_dyn_arr_push(argv, opts);
    scr_dyn_arr_push(argv, handler);
    if (ret_kind == SCR_FD_RET_BOOL) {
      (void)((bool (*)(ScrClosure *, ScrDyn *))fn->fn)(fn, argv);
    } else if (ret_kind == SCR_FD_RET_VOID) {
      ((void (*)(ScrClosure *, ScrDyn *))fn->fn)(fn, argv);
    } else {
      ScrDyn *r = ((ScrDyn * (*)(ScrClosure *, ScrDyn *))fn->fn)(fn, argv);
      scr_dyn_release(r);
    }
  } else {
    if (ret_kind == SCR_FD_RET_BOOL) {
      (void)((bool (*)(ScrClosure *, ScrDyn *, ScrDyn *))fn->fn)(fn, opts, handler);
    } else if (ret_kind == SCR_FD_RET_VOID) {
      ((void (*)(ScrClosure *, ScrDyn *, ScrDyn *))fn->fn)(fn, opts, handler);
    } else {
      ScrDyn *r = ((ScrDyn * (*)(ScrClosure *, ScrDyn *, ScrDyn *))fn->fn)(fn, opts, handler);
      scr_dyn_release(r);
    }
  }
  scr_closure_release(fn);

  /* A dispatcher that THREW. The oracle does not let it out of fetch:
   * undici catches it and rejects with the network-failure shape instead,
   * so the program sees TypeError "fetch failed" with the thrown error on
   * `cause` — measured on v25.9.0 beside the onError shape, which
   * produces the identical rejection. Letting the exception ride out of
   * the fetch CALL here would be a divergence and a worse one, because
   * fetch never throws synchronously. */
  if (scr_exc_pending()) {
    ScrCaught *c = scr_exc_take();
    /* A throw AFTER the handler already answered does not un-answer it. */
    if (!h->settled) {
      h->settled = true;
      scr_fetch_xfer_fail(h->t, "UND_ERR_DISPATCH");
    }
    scr_caught_release(c);
  }
  fd_release(h);
}

/* THE SIGNAL FIRED. undici calls the `abort` its dispatcher handed us
 * through `onConnect`, and this is that call. A dispatcher that never
 * called onConnect gets nothing, which is also what the oracle does —
 * there is no way to reach it.
 *
 * The transfer's own rejection is the fetch unit's half of this: it asks
 * the signal and produces the AbortError rather than "fetch failed",
 * exactly as an aborted DIALLED hop does. The two halves are separate on
 * purpose, because the rejection must happen whether or not a dispatcher
 * ever offered an abort. */
static void fd_abort(void *p) {
  FdHop *h = (FdHop *)p;
  if (h == NULL || h->abort == NULL || h->settled) return;
  ScrDyn *r = scr_dyn_call(h->abort, NULL, 0, "abort");
  scr_dyn_release(r);
  /* A dispatcher whose abort THROWS does not get to replace the
   * AbortError the fetch is about to reject with: the abort is a
   * courtesy, the rejection is the answer. */
  if (scr_exc_pending()) {
    ScrCaught *c = scr_exc_take();
    scr_caught_release(c);
  }
}

void scr_fetch_dispatch_install(void) {
  scr_fetch_dispatch_seam(&fd_hop);
  scr_fetch_dispatch_abort_seam(&fd_abort);
}
