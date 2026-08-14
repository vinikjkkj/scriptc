/* scr_http_pipe.c — the Writable adapter that lets a Readable pipe INTO
 * an http.ClientRequest.
 *
 * Its OWN translation unit purely for the LINK GATE, and the gate exists
 * for a reason that was measured rather than guessed: living in
 * scr_http.c, this code made scr_http.o reference scr_stream_pipe,
 * scr_stream_new_writable and the three completion callbacks
 * UNCONDITIONALLY. There is no --gc-sections on the win32 or linux
 * links, so every program that merely made an http request — and never
 * piped anything — stopped linking with six undefined symbols unless
 * scr_stream.c came too. A plain `http.request` probe caught it.
 *
 * Gated on the `http.clientPipeFrom` libCall appearing in the IR
 * (moduleUsesHttpPipe). The gate cannot be wrong in the dangerous
 * direction: a wrong `false` is a loud unresolved symbol at link time,
 * never a wrong answer at run time. And a program that CAN reach this
 * code necessarily builds a Readable first, so scr_stream.c is already
 * in its link — the dependency is declared anyway, so the selection-time
 * check reports the gate story instead of the linker reporting a symbol.
 *
 * Everything here goes through the PUBLIC scr_http_client_* surface; the
 * unit needs no view of struct ScrHttpClientReq. */
#include "scr_runtime.h"

/* ── readable.pipe(req): a native Writable over a ClientRequest ────────
 * scr_stream_pipe needs TWO ScrStreams and a ClientRequest is not one —
 * it is an ScrHttpClientReq with its own listener lists. A native
 * Writable whose _write forwards the bytes, whose _final ends the
 * request and whose _destroy destroys it makes the request a legal pipe
 * destination and inherits pipe's backpressure, end-propagation and
 * error semantics unchanged, instead of restating them here.
 *
 * The adapter OWNS the request (+1) and the request holds nothing back,
 * so the pair cannot cycle. It is deliberately NOT cached on the
 * request: a cache needs a back-pointer the request cannot clear when
 * the adapter outlives it (the pipe holds the adapter too), and it buys
 * nothing — every write funnels into scr_http_client_write_bytes in call
 * order, so a direct req.write() and a pipe cannot disagree about
 * ordering however many adapters exist.
 *
 * The adapter never reaches the IR: scr_http_client_pipe_from below is
 * the whole surface, so there is no stream-typed value for a lowering to
 * get wrong and no new handle kind to wire through eighteen switches. */
static ScrClosure *scr_hcw_closure(ScrHttpClientReq *c, void *fn) {
  ScrClosure *cb = scr_closure_new(fn, 1);
  ScrBox *box = scr_box_new_obj(&scr_http_client_retain_v, &scr_http_client_release_v, NULL);
  scr_box_set_ref(box, scr_http_client_retain(c));
  cb->caps[0] = box;
  return cb;
}

static void scr_hcw_write_inv(ScrClosure *cb, ScrStream *s, ScrBytes *chunk /*borrowed*/) {
  ScrHttpClientReq *c = (ScrHttpClientReq *)scr_box_get_ref(cb->caps[0]); /* +1 */
  if (c != NULL) {
    scr_http_client_write_bytes(c, chunk);
    scr_http_client_release(c);
  }
  /* the forward is synchronous, so the write completes in place — the
   * request's own socket buffering is what actually paces the wire */
  scr_stream_write_done(s, NULL);
}

static void scr_hcw_final_inv(ScrClosure *cb, ScrStream *s) {
  ScrHttpClientReq *c = (ScrHttpClientReq *)scr_box_get_ref(cb->caps[0]);
  if (c != NULL) {
    scr_http_client_end(c); /* pipe's end:true default lands here */
    scr_http_client_release(c);
  }
  scr_stream_final_done(s, NULL);
}

/* Teardown of the ADAPTER is not teardown of the request. A clean finish
 * reaches here too — autoDestroy destroys a Writable once it has
 * finished — and destroying the request there would kill the exchange
 * the instant the body was fully sent, before its response could arrive
 * ('socket hang up', measured the hard way). Node's `end` of a piped
 * upload leaves the request open and waiting, so only a destroy carrying
 * an ERROR is forwarded. */
static void scr_hcw_destroy_inv(ScrClosure *cb, ScrStream *s, ScrError *err /*borrowed*/) {
  ScrHttpClientReq *c = (ScrHttpClientReq *)scr_box_get_ref(cb->caps[0]);
  if (c != NULL) {
    if (err != NULL) scr_http_client_destroy_err(c, err);
    scr_http_client_release(c);
  }
  /* The error is forwarded to the REQUEST above and NOT re-emitted here.
   * An 'error' with no listener is fatal (scr_emitter_emit_error is
   * Node's throwing EventEmitter path), and the adapter is invisible —
   * the user has no way to attach a handler to it, so emitting on it
   * could only ever crash a program that was handling the error properly
   * on the surface Node actually gives it. */
  scr_stream_destroy_done(s, NULL);
}

ScrHttpClientReq *scr_http_client_pipe_from(ScrStream *src, ScrHttpClientReq *c, bool end) {
  ScrStream *w = scr_stream_new_writable(
      -1 /* the byte default */, true /* autoDestroy */, true /* emitClose */,
      scr_hcw_closure(c, (void *)&scr_hcw_write_inv), &scr_hcw_write_inv,
      scr_hcw_closure(c, (void *)&scr_hcw_final_inv), &scr_hcw_final_inv,
      scr_hcw_closure(c, (void *)&scr_hcw_destroy_inv), &scr_hcw_destroy_inv);
  ScrStream *d = scr_stream_pipe(src, w, end); /* d is w, +1 */
  if (d != NULL) scr_stream_release(d);
  scr_stream_release(w); /* the pipe edge holds the adapter now */
  /* Node's pipe answers the DESTINATION — the request itself — and a
   * libCall result is OWNED (+1) by the caller, which the emitter proves
   * by releasing it: `call void @scr_http_client_release_v(ptr %t84)`.
   * Returning it borrowed was an over-release that no test could see,
   * because the registry and the caller's own local keep the count
   * positive and scr_rc_audit_at_exit does not count http clients. */
  return scr_http_client_retain(c);
}

