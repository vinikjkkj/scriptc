/* `globalThis.WebSocket` — the WHATWG WebSocket global, as a runtime
 * handle the emitted code drives.
 *
 * The protocol and the socket already exist: scr_websocket.c parses
 * frames, scr_ws_client.c dials and pumps them. What is missing between
 * them and a compiled program is the API OBJECT — a value with mutable
 * `onopen`/`onmessage`/`onclose`/`onerror` slots, a live `readyState`, a
 * `binaryType`, `send` and `close`. That object is a RECORD whose shape
 * the program's own types decide, so it can only be built by emitted
 * code: this unit owns the socket and the state machine, and calls back
 * through a plain function pointer the compiler supplies, with the
 * record as the opaque `user`.
 *
 * Deliberately NOT a ScrClosure callback: a closure capturing the record
 * would close a reference cycle (record → send/close closures → handle →
 * closure → record) through a box the collector cannot see into. The
 * handle instead holds the record WEAKLY, and its own lifetime is the
 * record's: the send/close closures share one box over this handle, so
 * the last release of the record frees the socket. Nothing can therefore
 * fire into a dead record — see scr_ws_global_free.
 *
 * Lifetime, precisely:
 *   record  --owns-->  send/close closures  --own-->  box  --owns--> handle
 *   handle  --weak-->  record
 * A free that lands while the loop is inside a callback (the program
 * dropped its last reference from an onmessage body) DEFERS the teardown
 * to the end of the dispatch — scr_ws_client_free would otherwise pull
 * the conn out from under scr_ws_conn_recv, which is still on the stack.
 */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scr_url_internal.h"
#include "scr_ws_client.h"
#include "scr_ws_global.h"

struct ScrWsGlobal {
  size_t rc;
  ScrWsClient *c; /* owned; NULL once freed */
  ScrWsGlobalFire fire;
  /* The emitted API record, held STRONG while the socket can still
   * deliver an event. That is not decoration: in JS a dialing or open
   * WebSocket is reachable from the platform, so
   *
   *     socket.onopen = () => socket.send('hi')
   *
   * with no other reference stays alive. A weak edge loses exactly that
   * program: its only reference is the record <-> handler cycle, the
   * collector reclaims it, and the connection silently never fires
   * (measured -- the handshake completed on the wire and no event came).
   * The reference drops the moment nothing further can fire (a close, or
   * the transport error that ends the socket), which is what keeps a
   * reconnect loop from growing. */
  void *user;
  void (*user_release)(void *);
  bool user_held;
  bool want_drop;
  /* Non-zero while a dispatch is on the stack: a free arriving from a
   * callback body waits for it. */
  int depth;
  bool want_free;
  /* Set the moment the socket is finished, so a second message already
   * parsed out of the same read cannot fire after it. */
  bool dead;
};

static void wsg_free_now(ScrWsGlobal *g);

/* ── the ready-state notification ────────────────────────────── */

static void wsg_state(ScrWsGlobal *g) {
  if (g->dead || g->fire == NULL) return;
  g->fire(g->user, SCR_WSG_STATE, scr_ws_client_ready_state(g->c), NULL, 0, false, 0, NULL, 0,
          false);
}

/* ── scr_ws_client's four callbacks, forwarded to the emitted thunk ── */

static void wsg_enter(ScrWsGlobal *g) { g->depth++; }

/* Dropping the platform reference can be the last one, and the free that
 * follows reaches scr_ws_client_free from inside scr_ws_conn_recv -- which
 * is why the CLIENT defers its own teardown the same way this does. */
static void wsg_leave(ScrWsGlobal *g) {
  if (--g->depth != 0) return;
  if (g->want_drop) {
    g->want_drop = false;
    if (g->user_held) {
      void *u = g->user;
      g->user_held = false;
      g->user = NULL;
      g->user_release(u); /* may re-enter scr_ws_global_free */
      return;             /* which then did the teardown, or nobody owns us */
    }
  }
  if (g->want_free) {
    g->want_free = false;
    wsg_free_now(g);
  }
}

static void wsg_on_open(void *u) {
  ScrWsGlobal *g = u;
  if (g->dead) return;
  wsg_enter(g);
  g->fire(g->user, SCR_WSG_OPEN, scr_ws_client_ready_state(g->c), NULL, 0, false, 0, NULL, 0,
          false);
  wsg_leave(g);
}

static void wsg_on_message(void *u, const uint8_t *d, size_t n, bool is_text) {
  ScrWsGlobal *g = u;
  if (g->dead) return;
  wsg_enter(g);
  g->fire(g->user, SCR_WSG_MESSAGE, scr_ws_client_ready_state(g->c), d, n, is_text, 0, NULL, 0,
          false);
  wsg_leave(g);
}

static void wsg_on_close(void *u, uint16_t code, const uint8_t *reason, size_t rlen) {
  ScrWsGlobal *g = u;
  if (g->dead) return;
  wsg_enter(g);
  /* wasClean: the connection was closed through the protocol's own
   * handshake rather than torn down. scr_websocket.c reports code 1006
   * ("abnormal closure") exactly when no close frame was exchanged,
   * which is the same distinction the browser event carries. */
  g->fire(g->user, SCR_WSG_CLOSE, scr_ws_client_ready_state(g->c), NULL, 0, false, (int)code,
          (const char *)reason, rlen, code != 1006);
  g->dead = true;      /* CLOSED is terminal */
  g->want_drop = true; /* and the platform lets go here */
  wsg_leave(g);
}

static void wsg_on_error(void *u, const char *msg) {
  ScrWsGlobal *g = u;
  if (g->dead) return;
  wsg_enter(g);
  g->fire(g->user, SCR_WSG_ERROR, scr_ws_client_ready_state(g->c), NULL, 0, false, 0, msg,
          msg != NULL ? strlen(msg) : 0, false);
  /* NOT want_drop: a close ALWAYS follows an error (scr_ws_client.h),
   * and dropping the platform reference here would free the record
   * out from under the close event one call later. */
  wsg_leave(g);
}

/* ── construction ───────────────────────────────────────────────────── */

/* The WHATWG "WebSocket URL record" steps, which are NOT the same as
 * "parse a ws:// URL":
 *   - http:/https: are REMAPPED to ws:/wss: (so new WebSocket('https://h')
 *     is legal and dials TLS),
 *   - any other scheme is a SyntaxError, not a TypeError,
 *   - a fragment is a SyntaxError.
 * Node's wording is reproduced verbatim, including the odd
 * "TypeError: Invalid URL" text undici puts inside its SyntaxError, so a
 * program that prints e.message reads the same in both.
 * Returns a +1 normalized URL, or NULL with the SyntaxError pending. */
/* scr_throw_error_named MOVES both strings into the error object. */
static void wsg_syntax(const char *msg, size_t len) {
  scr_throw_error_named(scr_str_new("SyntaxError", 11), scr_str_new(msg, len));
}

static bool wsg_prefix_ci(const ScrStr *s, const char *pfx, size_t n) {
  if (s->len < n) return false;
  for (size_t i = 0; i < n; i++) {
    char c = s->data[i];
    if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
    if (c != pfx[i]) return false;
  }
  return true;
}

static ScrStr *wsg_normalize_url(ScrStr *url) {
  ScrStr *s;
  if (wsg_prefix_ci(url, "http://", 7) || wsg_prefix_ci(url, "https://", 8)) {
    /* "http" -> "ws", "https" -> "wss": the same authority, one scheme
     * letter swapped. Everything after the scheme is untouched. */
    bool secure = wsg_prefix_ci(url, "https", 5);
    size_t skip = secure ? 5 : 4;
    const char *pfx = secure ? "wss" : "ws";
    size_t plen = secure ? 3 : 2;
    char *buf = malloc(plen + (url->len - skip) + 1);
    if (buf == NULL) return NULL;
    memcpy(buf, pfx, plen);
    memcpy(buf + plen, url->data + skip, url->len - skip);
    s = scr_str_new(buf, plen + url->len - skip);
    free(buf);
  } else {
    s = scr_str_retain(url);
  }
  ScrUrl *u = scr_url_new(s);
  if (u == NULL) {
    /* scr_url_new left its own TypeError pending; the API says the
     * constructor throws a SyntaxError here. */
    scr_exc_clear();
    scr_str_release(s);
    static const char m[] = "TypeError: Invalid URL";
    wsg_syntax(m, sizeof m - 1);
    return NULL;
  }
  bool ok = (u->scheme->len == 2 && memcmp(u->scheme->data, "ws", 2) == 0) ||
            (u->scheme->len == 3 && memcmp(u->scheme->data, "wss", 3) == 0);
  if (!ok) {
    scr_url_release(u);
    scr_str_release(s);
    static const char m[] = "expected a ws: or wss: url";
    wsg_syntax(m, sizeof m - 1);
    return NULL;
  }
  if (u->fragment->len > 0) {
    scr_url_release(u);
    scr_str_release(s);
    static const char m[] = "hash";
    wsg_syntax(m, sizeof m - 1);
    return NULL;
  }
  scr_url_release(u);
  return s;
}

ScrWsGlobal *scr_ws_global_new(ScrStr *url, ScrStr *protocols, ScrWsGlobalFire fire) {
  static const ScrWsClientCallbacks cb = {
      .on_open = &wsg_on_open,
      .on_message = &wsg_on_message,
      .on_close = &wsg_on_close,
      .on_error = &wsg_on_error,
  };
  ScrStr *norm = wsg_normalize_url(url);
  if (norm == NULL) return NULL; /* SyntaxError pending */
  ScrWsGlobal *g = calloc(1, sizeof *g);
  if (g == NULL) { scr_str_release(norm); return NULL; }
  g->rc = 1;
  g->fire = fire;
  /* wss:// wants the TLS leg, and it is always there: the driver gate
   * that compiles this unit also links scr_tls.c and the vendored
   * mbedTLS, exactly as the native fetch bridge does. A WebSocket that
   * could not dial wss:// would not be one. */
  static const ScrWsTlsOps tls = {
      .ctx = &scr_tls_fetch_client_ctx,
      .wrap = &scr_tls_fetch_client_wrap,
  };
  g->c = scr_ws_client_connect(norm, protocols, &cb, g, &tls);
  scr_str_release(norm);
  if (g->c == NULL) { /* the dial could not even start: exception pending */
    free(g);
    return NULL;
  }
  return g;
}

void scr_ws_global_set_user(ScrWsGlobal *g, void *user, void *(*retain)(void *),
                             void (*release)(void *)) {
  g->user = retain(user);
  g->user_release = release;
  g->user_held = true;
}

/* The MESSAGE event's `data`, chosen by binaryType exactly as the API
 * says: a text frame is always a string; a binary frame is an
 * ArrayBuffer under 'arraybuffer'. Under 'blob' -- the DEFAULT -- the
 * browser hands over a Blob, a surface this runtime does not have, so
 * that arm takes the deferred fence rather than quietly substituting a
 * different object: a program that never set binaryType would otherwise
 * be told its frames are ArrayBuffers when Node says Blob. */
ScrDyn *scr_ws_global_message_data(const ScrStr *binary_type, const uint8_t *d, size_t n,
                                    bool is_text) {
  if (is_text) {
    ScrStr *s = scr_str_new((const char *)d, n);
    ScrDyn *v = scr_dyn_new_str(s);
    scr_str_release(s);
    return v;
  }
  if (binary_type != NULL && binary_type->len == 11 &&
      memcmp(binary_type->data, "arraybuffer", 11) == 0) {
    ScrBytes *b = scr_bytes_new(SCR_BYTES_BUF, (double)n);
    if (b == NULL) return scr_dyn_undefined(); /* pending */
    if (n > 0) memcpy(b->data, d, n);
    ScrDyn *v = scr_dyn_new_bytes_copy(b);
    scr_bytes_release(b);
    return v;
  }
  {
    static const char msg[] =
        "a binary WebSocket frame under binaryType 'blob' would be a Blob, which has no "
        "scriptc lowering yet -- set binaryType = 'arraybuffer' before the socket opens";
    scr_throw_error_msg_code(SCR_ERR_ERROR, msg, sizeof msg - 1, "SC2020");
  }
  return scr_dyn_undefined();
}

/* ── the record's own methods ───────────────────────────────────────── */

/* The WebSocket API's InvalidStateError: send() before the handshake
 * completes is a throw in both browsers and Node's global WebSocket, not
 * a buffered write (scr_ws_client would happily buffer it). */
static bool wsg_send_ready(const ScrWsGlobal *g) {
  if (g->dead || g->c == NULL || scr_ws_client_ready_state(g->c) == SCR_WS_CONNECTING) {
    scr_throw_error_named(scr_str_new("InvalidStateError", 17),
                          scr_str_new("Sent before connected.", 22));
    return false;
  }
  return true;
}

void scr_ws_global_send_str(ScrWsGlobal *g, const ScrStr *s) {
  if (!wsg_send_ready(g)) return;
  scr_ws_client_send(g->c, (const uint8_t *)s->data, s->len, true);
}

void scr_ws_global_send_bytes(ScrWsGlobal *g, const ScrBytes *b) {
  if (!wsg_send_ready(g)) return;
  scr_ws_client_send(g->c, b->data, (size_t)scr_bytes_byte_len(b), false);
}

void scr_ws_global_close(ScrWsGlobal *g, bool has_code, double code, const ScrStr *reason) {
  /* WHATWG close() argument validation, verbatim: any code other than
   * 1000 or 3000..4999 is an InvalidAccessError, and a reason longer
   * than 123 UTF-8 bytes a SyntaxError. Both are observable — zapo's
   * closeSocketSafe wraps close() in a try/catch precisely because the
   * browser throws here. */
  if (has_code && !(code == 1000 || (code >= 3000 && code <= 4999))) {
    scr_throw_error_named(scr_str_new("InvalidAccessError", 18),
                          scr_str_new("invalid code", 12));
    return;
  }
  if (reason != NULL && reason->len > 123) {
    char m[96];
    int n = snprintf(m, sizeof m,
                     "Reason must be less than 123 bytes; received %zu", reason->len);
    wsg_syntax(m, (size_t)n);
    return;
  }
  if (g->dead || g->c == NULL) return;
  {
    int before = scr_ws_client_ready_state(g->c);
    /* No argument means NO status code on the wire (an empty close body),
     * which is what makes the peer report 1005 rather than a 1000 this
     * side invented. scr_ws_conn_close spells that as code 0. */
    scr_ws_client_close(g->c, has_code ? (uint16_t)code : 0,
                        reason != NULL ? (const uint8_t *)reason->data : NULL,
                        reason != NULL ? reason->len : 0);
    if (scr_ws_client_ready_state(g->c) != before) wsg_state(g);
  }
}

double scr_ws_global_ready_state(const ScrWsGlobal *g) {
  if (g == NULL || g->dead || g->c == NULL) return SCR_WS_CLOSED;
  return (double)scr_ws_client_ready_state(g->c);
}

/* ── lifetime ───────────────────────────────────────────────────────── */

static void wsg_free_now(ScrWsGlobal *g) {
  if (g->c != NULL) {
    scr_ws_client_free(g->c); /* defers itself if a callback is on the stack */
    g->c = NULL;
  }
  free(g);
}

void scr_ws_global_free(ScrWsGlobal *g) {
  if (g == NULL) return;
  /* dead FIRST: one read can carry several frames, so the very next
   * on_message out of the same scr_ws_conn_recv must not fire into the
   * record the callback we are inside of just released. */
  g->dead = true;
  if (g->depth > 0) {
    g->want_free = true;
    return;
  }
  wsg_free_now(g);
}
void *scr_ws_global_retain_v(void *p) {
  ScrWsGlobal *g = p;
  if (g != NULL) g->rc++;
  return p;
}

void scr_ws_global_release_v(void *p) {
  ScrWsGlobal *g = p;
  if (g == NULL) return;
  if (--g->rc == 0) scr_ws_global_free(g);
}
