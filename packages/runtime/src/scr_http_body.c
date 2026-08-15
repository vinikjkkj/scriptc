/* scr_http_body.c — the READABLE VIEW of an IncomingMessage.
 *
 * Node models `http.IncomingMessage` as `class IncomingMessage extends
 * stream.Readable`: one object, two surfaces. This runtime does not.
 * An IncomingMessage is an `ScrHttpReq` (a parsed head plus four
 * listener lists, scr_http.c); a Readable is an `ScrStream` (the
 * ScrEmitter prefix plus a readable state block, scr_stream.c). They
 * are different structs with different layouts, so `body: res` into a
 * `Readable | null` slot is NOT the pointer reinterpret the Duplex
 * widening is — there is no prefix to reinterpret. It needs an OBJECT.
 *
 * So this unit is the mirror image of scr_http_pipe.c. That one wraps a
 * ClientRequest in a native WRITABLE so a Readable may pipe into it;
 * this one wraps an IncomingMessage in a native READABLE so its body may
 * flow anywhere a Readable is wanted (pipe, pipeline, for-await,
 * Readable.destroy, the whole surface) — inheriting all of it rather
 * than restating any of it.
 *
 * Its OWN translation unit for the LINK GATE, and for the reason
 * scr_http_pipe.c measured: living in scr_http.c this code would make
 * scr_http.o reference scr_stream_new_readable, scr_stream_push,
 * scr_stream_push_null, scr_stream_destroy and the two completion
 * entries UNCONDITIONALLY, and there is no --gc-sections on the win32
 * or linux links, so every program that merely made an http request
 * would stop linking unless scr_stream.c came too. Gated on the
 * `http.reqBodyStream` libCall appearing in the IR (moduleUsesHttpBody);
 * a wrong `false` is a loud unresolved symbol, never a wrong answer.
 *
 * ── OWNERSHIP, and why there is no cycle ──────────────────────────────
 * Exactly one direction is strong:
 *
 *     request  ──(+1, through the opaque body-view slot)──▶  stream
 *     stream   ──(BORROWED, through a clearable box)──────▶  request
 *
 * The request owns its view for its whole life and frees it through the
 * callback installed here, so scr_http.c names no stream symbol and the
 * two units stay independently linkable. The view's back-pointer to the
 * request is borrowed and NULLed by that same callback BEFORE the stream
 * reference is dropped, so a `_read`/`_destroy` arriving after the
 * request is gone is a no-op instead of a use-after-free.
 *
 * That the request outlives the body it is feeding is not an assumption:
 * the connection holds `conn->req` for the whole exchange, and the
 * exchange is over exactly when the body has ended or the socket has
 * died — which is exactly when the stream no longer needs a source.
 *
 * The four listeners this unit registers ON the request capture the
 * stream BORROWED for the same reason in reverse: the request's own +1
 * is what keeps it alive, and those listeners drop at settlement (the
 * settle-releases-listeners story), strictly before the view is freed.
 *
 * The result: memoized (a second `body: res` on the same response
 * answers the SAME stream, Node's identity), no cycle, and nothing for
 * the RC audit to find.
 *
 * ── WHAT IS NOT NODE ──────────────────────────────────────────────────
 * The view is a DIFFERENT object from the request. `res` and the value
 * in the Readable slot are one object in Node and two here, so a
 * listener registered on `res` and one registered on the slot are two
 * emitters, and their relative order is the order the chunks cross this
 * seam (the request's listener fires first, then the stream's, deferred
 * by the tick queue) rather than pure registration order. A program that
 * consumes the body through exactly one of the two — which is every
 * program that treats a response as a stream — cannot see it. */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>

/* Node: IncomingMessage's readableHighWaterMark is 16384, not the 65536
 * byte default a bare `new Readable()` gets. Measured against v25.9.0. */
#define SCR_HTTP_BODY_HWM 16384

static void scr_http_body_oom(void) {
  fputs("scriptc: out of memory\n", stderr);
  abort();
}

typedef struct ScrHttpBodyView {
  size_t rc;
  ScrHttpReq *r;  /* BORROWED — NULL once the request has detached */
  ScrStream *s;   /* +1 — the request's single reference to its view */
  ScrBox *box;    /* the shared cap every closure below holds (+1 each) */
  bool tearing;   /* a teardown is already unwinding through this pair */
} ScrHttpBodyView;

static void *scr_http_body_retain(void *p) {
  ScrHttpBodyView *v = (ScrHttpBodyView *)p;
  if (v != NULL) v->rc++;
  return p;
}

static void scr_http_body_release(void *p) {
  ScrHttpBodyView *v = (ScrHttpBodyView *)p;
  if (v == NULL) return;
  if (--v->rc == 0) free(v);
}

/* The request's free path calls this through the function pointer it was
 * handed, so scr_http.c never names scr_stream_release. Clear the
 * back-pointer FIRST: releasing the stream can run its destroy path, and
 * that path must see a source that is already gone. */
static void scr_http_body_detach(void *p) {
  ScrHttpBodyView *v = (ScrHttpBodyView *)p;
  if (v == NULL) return;
  v->r = NULL;
  ScrStream *s = v->s;
  v->s = NULL;
  scr_http_body_release(v); /* the request's own reference */
  if (s != NULL) scr_stream_release(s);
}

/* Every callback below opens with this and closes with a release: the
 * box hands out a +1, the scr_http_pipe.c convention. */
static ScrHttpBodyView *scr_http_body_of(ScrClosure *cb) {
  return (ScrHttpBodyView *)scr_box_get_ref(cb->caps[0]);
}

static bool scr_http_body_live(const ScrHttpBodyView *v) {
  return v->s != NULL && !v->tearing && scr_stream_prop(v->s, "destroyed") == 0;
}

/* ── the request's side: body bytes become pushes ─────────────────────── */

static void scr_http_body_data(ScrClosure *cb, ScrBytes *chunk /*borrowed*/) {
  ScrHttpBodyView *v = scr_http_body_of(cb);
  if (scr_http_body_live(v)) {
    /* push answers false above the high-water mark — hold the request
     * exactly there. Its pause() buffers the parser's output and its
     * resume() drains it, so this is real backpressure and not a drop. */
    if (!scr_stream_push(v->s, chunk) && v->r != NULL) scr_http_req_pause(v->r);
  }
  scr_http_body_release(v);
}

static void scr_http_body_end(ScrClosure *cb) {
  ScrHttpBodyView *v = scr_http_body_of(cb);
  if (scr_http_body_live(v)) scr_stream_push_null(v->s);
  scr_http_body_release(v);
}

/* Registered with scr_child_err_thunk_error as the ADAPTER so the error
 * arrives as an OBJECT with its name/code/identity intact when the
 * emitter has one, and as an Error built from the message (with the
 * errno name recovered out of the text) when it does not — the same
 * two-case story every 'error' listener on this handle already gets. */
static void scr_http_body_err(ScrClosure *cb, ScrError *err /*+1*/) {
  ScrHttpBodyView *v = scr_http_body_of(cb);
  if (scr_http_body_live(v)) {
    v->tearing = true;
    scr_stream_release(scr_stream_destroy(v->s, err));
    v->tearing = false;
  }
  scr_error_release(err);
  scr_http_body_release(v);
}

/* The body stopped without ending: the connection died under it. Node
 * destroys the response; the readable's own 'close' follows. An 'end'
 * that already ran leaves nothing to do — autoDestroy closes the view. */
static void scr_http_body_close(ScrClosure *cb) {
  ScrHttpBodyView *v = scr_http_body_of(cb);
  if (scr_http_body_live(v) && scr_stream_prop(v->s, "rs:ended") == 0) {
    v->tearing = true;
    scr_stream_release(scr_stream_destroy(v->s, NULL));
    v->tearing = false;
  }
  scr_http_body_release(v);
}

/* ── the stream's side: demand becomes resume, destroy becomes destroy ── */

static void scr_http_body_read(ScrClosure *cb, ScrStream *s, double size) {
  (void)s;
  (void)size;
  ScrHttpBodyView *v = scr_http_body_of(cb);
  if (v->r != NULL && !v->tearing) scr_http_req_resume(v->r);
  scr_http_body_release(v);
}

static void scr_http_body_destroy(ScrClosure *cb, ScrStream *s, ScrError *err /*borrowed*/) {
  (void)err;
  ScrHttpBodyView *v = scr_http_body_of(cb);
  if (v->r != NULL && !v->tearing) {
    /* body.destroy() IS res.destroy(): Node's response destroy tears the
     * socket down. `tearing` keeps the request's own close/error events
     * from re-entering the destroy we are already inside. */
    v->tearing = true;
    scr_http_req_destroy(v->r);
    v->tearing = false;
  }
  scr_http_body_release(v);
  scr_stream_destroy_done(s, NULL);
}

static ScrClosure *scr_http_body_closure(ScrHttpBodyView *v, void *fn) {
  ScrClosure *cb = scr_closure_new(fn, 1);
  cb->caps[0] = scr_box_retain(v->box);
  return cb;
}

/* res AS a Readable (+1). Memoized on the request, so the conversion is
 * idempotent and `body === body` the way Node's one object is. */
ScrStream *scr_http_req_body_stream(ScrHttpReq *r) {
  ScrHttpBodyView *old = (ScrHttpBodyView *)scr_http_req_body_view(r);
  if (old != NULL && old->s != NULL) return scr_stream_retain(old->s);

  ScrHttpBodyView *v = (ScrHttpBodyView *)calloc(1, sizeof *v);
  if (v == NULL) scr_http_body_oom();
  v->rc = 1; /* the request's attachment, taken below */
  v->r = r;
  /* A borrowed payload: identity in, nothing out. The box carries no
   * cycle header (obj_trace NULL) because the view is not a traced
   * object — the collector never needs to walk this edge, which is the
   * whole point of keeping it borrowed. */
  v->box = scr_box_new_obj(&scr_http_body_retain, &scr_http_body_release, NULL);
  scr_box_set_ref(v->box, scr_http_body_retain(v));

  ScrStream *s = scr_stream_new_readable(
      (double)SCR_HTTP_BODY_HWM, true /* autoDestroy */, true /* emitClose */,
      scr_http_body_closure(v, (void *)&scr_http_body_read), &scr_http_body_read,
      scr_http_body_closure(v, (void *)&scr_http_body_destroy), &scr_http_body_destroy);
  v->s = s; /* the request's +1 lives here */
  scr_http_req_attach_body_view(r, v, &scr_http_body_detach);

  /* The listeners go on AFTER the stream exists so a synchronous 'end'
   * (a body that already completed) has somewhere to land. A response
   * whose body is already gone answers an ended Readable rather than one
   * that never ends. */
  if (scr_http_req_readable(r)) {
    scr_http_req_on_data(r, scr_http_body_closure(v, (void *)&scr_http_body_data),
                         &scr_http_body_data, false);
    scr_http_req_on_end(r, scr_http_body_closure(v, (void *)&scr_http_body_end), false);
    scr_http_req_on_error(r, scr_http_body_closure(v, (void *)&scr_http_body_err),
                          &scr_child_err_thunk_error, false);
    scr_http_req_on_close(r, scr_http_body_closure(v, (void *)&scr_http_body_close), false);
  } else {
    scr_stream_push_null(s);
  }
  /* The box's constructor reference: every closure took its own, and
   * `v->box` is only read while building. Giving it up here is what
   * makes the view's own last reference the BOX's, so the ring
   * view→stream→closures→box→view unwinds the moment detach drops the
   * view's hold on the stream. */
  scr_box_release(v->box);
  return scr_stream_retain(s);
}
