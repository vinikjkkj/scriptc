/* The `signal` option on a static fetch() — the SEAM between two
 * independently link-gated units, one level up from scr_abort_http.c.
 *
 * scr_abort.c rides `moduleUsesAbortSignal` and scr_fetch_static.c rides
 * `fetchStatic`: a program can fetch without ever naming AbortSignal, and
 * hold a signal without ever fetching, so neither unit may name a symbol
 * of the other. This file names both and is gated on the conjunction
 * (cc.ts, the way scr_abort_http.c and scr_cipher_key.c are). It is a
 * table of five function pointers precisely because both halves already
 * exist: scr_http_client_signal does the whole teardown (that is why
 * cc.ts turns `abortHttp` on whenever this unit links), and the fetch
 * unit only needs to be able to ASK whether a failure was an abort.
 *
 * Node v25.9.0, measured (a local server, an abort at each point):
 *
 *   before the call    fetch() answers an already-REJECTED promise; no
 *                      socket is dialed.
 *   before the head    the fetch() promise rejects; no Response exists.
 *   mid-body           the response promise has ALREADY resolved, so the
 *                      rejection lands on the body consumer —
 *                      response.text() rejects.
 *   after the body     a NO-OP. A settled fetch cannot be aborted.
 *
 * THE DIVERGENCE, stated rather than hidden: Node rejects with the
 * signal's own `reason` — `controller.abort(new Error("x"))` makes
 * fetch reject with THAT error object. The reason is an ScrDyn and the
 * rejection channel here is an ScrError; there is no dyn→ScrError
 * conversion that preserves identity, so every abort rejects with the
 * AbortError shape Node uses for its DEFAULT reason (name AbortError,
 * code ABORT_ERR, "This operation was aborted"). The rejection always
 * happens and always carries ABORT_ERR, so a program that branches on
 * `err.name === "AbortError"` — which is the documented way to detect
 * one — behaves identically; only a program that compares the reason by
 * identity sees the difference. Pinned in tests/harness/fetch-static.test.ts. */
#include <stdbool.h>
#include <string.h>

#include "scr_runtime.h"

/* Node's AbortError, the same shape scr_abort_http.c builds for a torn-down
 * request, with fetch's message. An ERROR rather than a DOMException: this
 * runtime has no DOMException value for the rejection channel, and an Error
 * with the right name and code is the half every consumer reads. */
static ScrError *scr_fetch_abort_error(void *sig) {
  (void)sig;
  ScrStr *m = scr_str_new("This operation was aborted", 26);
  ScrError *e = scr_error_new(SCR_ERR_ERROR, m);
  scr_str_release(m);
  scr_str_release(e->name);
  e->name = scr_str_new("AbortError", 10);
  if (e->code != NULL) scr_str_release(e->code);
  e->code = scr_str_new("ABORT_ERR", 9);
  return e;
}

static void *scr_fetch_abort_retain(void *sig) {
  return scr_abort_signal_retain((ScrAbortSignal *)sig);
}

static void scr_fetch_abort_release(void *sig) {
  scr_abort_signal_release((ScrAbortSignal *)sig);
}

static bool scr_fetch_abort_aborted(void *sig) {
  return scr_abort_signal_aborted((ScrAbortSignal *)sig);
}

/* Wires the signal into THIS HOP's client. Every redirect hop dials a new
 * client, so the fetch unit calls this once per hop; scr_http_client_signal
 * owns the listener's lifetime (its detach runs at 'close' or at free), so
 * a hop that finishes cleanly leaves nothing behind on the signal. The
 * pass-through's +1 is dropped: the fetch transfer already holds the
 * client. */
static void scr_fetch_abort_attach(void *sig, ScrHttpClientReq *c) {
  ScrHttpClientReq *same = scr_http_client_signal((ScrAbortSignal *)sig, c);
  scr_http_client_release(same);
}

/* Installed before %main runs (the compiler emits the call whenever both
 * gates are on), so an already-aborted signal handed to the very first
 * fetch is seen. */
void scr_fetch_abort_install(void) {
  scr_fetch_abort_seam(&scr_fetch_abort_retain, &scr_fetch_abort_release,
                       &scr_fetch_abort_attach, &scr_fetch_abort_aborted,
                       &scr_fetch_abort_error);
}
