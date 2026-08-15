/* The `signal` option on an http client request — the SEAM between two
 * independently link-gated units.
 *
 * scr_abort.c rides `moduleUsesAbortSignal` and scr_http.c rides the net/http
 * gates: a program can have either without the other, so neither unit may
 * name a symbol from the other. This file names both and is gated on the
 * conjunction (cc.ts, the way scr_cipher_key.c is gated on asym && cipher).
 * It is thirty lines of wiring precisely because both halves already exist:
 * the signal's native-listener entry point, and request.destroy(err) —
 * whose DEFERRED emission of the error OBJECT (identity, name and `code`
 * intact, through the error adapter rather than the message one) is exactly
 * what Node does to an aborted request.
 *
 * Node v25.9.0, measured rather than read (a local server, an abort at each
 * point in the exchange):
 *
 *   mid-flight        'error' AbortError / ABORT_ERR /
 *                     "The operation was aborted", then 'close'.
 *                     abort() RETURNS FIRST — the error arrives afterwards.
 *   already aborted   the request is destroyed synchronously at construction
 *                     (req.destroyed === true before the next statement) and
 *                     the same 'error' + 'close' follow; the connection is
 *                     dialed but no request head is ever sent.
 *   after completion  a NO-OP: no second 'error', no second 'close'.
 *   destroy() first   the destroy wins ('socket hang up'); the later abort
 *                     changes nothing.
 *   listeners         one 'abort' listener while in flight, zero once the
 *                     request has closed — the request removes its own.
 *
 * The reason is NOT the error. Whatever `controller.abort(reason)` carries —
 * the default AbortError DOMException, a user error with its own `code`, a
 * bare string — the request always receives the same AbortError with
 * code ABORT_ERR; Node passes the reason through as `cause`, which no
 * ScrError slot can hold and which the frontend refuses to read on a plain
 * Error (only %DOMException has a `cause` member), so the omission is loud
 * rather than silent. */
#include <stdbool.h>
#include <string.h>

#include "scr_runtime.h"

/* Node's AbortError for a torn-down request: an ERROR (not a DOMException —
 * `e instanceof Error` is true and `instanceof DOMException` is false in
 * Node), name AbortError, code ABORT_ERR, Node's exact message. Built fresh
 * per teardown, +1. The code does NOT start with "ERR_", so
 * scr_error_to_string leaves it unbracketed — "AbortError: The operation was
 * aborted", which is what String(err) answers in Node. */
static ScrError *scr_abort_http_error(void) {
  ScrStr *m = scr_str_new("The operation was aborted", 25);
  ScrError *e = scr_error_new(SCR_ERR_ERROR, m);
  scr_str_release(m);
  scr_str_release(e->name);
  e->name = scr_str_new("AbortError", 10);
  e->code = scr_str_new("ABORT_ERR", 9);
  return e;
}

/* The native 'abort' listener. `ctx` is the ScrHttpClientReq, borrowed — it
 * is kept alive by the client registry and it removes this entry before it
 * can die (scr_http_client_set_abort's detach, run at 'close' or at free).
 *
 * A request that has already finished is left alone: destroy() on a settled
 * handle is Node's no-op, and the detach normally means this listener is not
 * even registered by then. */
static void scr_abort_http_fire(void *ctx) {
  ScrHttpClientReq *c = (ScrHttpClientReq *)ctx;
  if (scr_http_client_destroyed(c)) return;
  ScrError *e = scr_abort_http_error();
  /* destroy(err), not destroy(): the 'error' listeners get the OBJECT, so
   * `code` survives. The emission stays DEFERRED (the socket's close hook
   * runs it), which is why abort() returns before the error — measured. */
  scr_http_client_destroy_err(c, e);
  scr_error_release(e);
}

/* Runs when the request settles (or is freed): the entry leaves the signal's
 * listener vector and the signal's reference drops. Both halves matter — a
 * detach that only released would leave a dangling context in the vector,
 * and one that only removed would leak the signal. */
static void scr_abort_http_detach(void *sig, void *client) {
  ScrAbortSignal *s = (ScrAbortSignal *)sig;
  if (s == NULL) return;
  scr_abort_signal_off_native(s, &scr_abort_http_fire, client);
  scr_abort_signal_release(s);
}

ScrHttpClientReq *scr_http_client_signal(ScrAbortSignal *s, ScrHttpClientReq *c) {
  if (s != NULL && !scr_http_client_destroyed(c)) {
    if (scr_abort_signal_aborted(s)) {
      /* Already aborted: Node destroys the request during construction and
       * never registers a listener (getEventListeners answers 0 straight
       * after the call — measured). The 'error' still arrives through the
       * queue, so the caller's on('error') registered on the next line is
       * in time, exactly as in Node. */
      scr_abort_http_fire(c);
    } else {
      scr_abort_signal_add_native(s, &scr_abort_http_fire, c);
      scr_http_client_set_abort(c, scr_abort_signal_retain(s), &scr_abort_http_detach);
    }
  }
  /* A PASS-THROUGH: the row's value is the request itself, +1 (the argument
   * is a borrowed frame temp). That is what lets one entry point serve every
   * request row — options, URL, URL+options, agent, createConnection, the
   * requestFn binding, callback or none — instead of doubling all of them. */
  return scr_http_client_retain(c);
}
