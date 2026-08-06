/* WebSocket client transport — see scr_ws_client.h for the split. */
#include "scr_ws_client.h"

#include <stdlib.h>
#include <string.h>

#include "scr_url_internal.h"
#include "scr_websocket.h"

struct ScrWsClient {
  ScrNetSocket *sock; /* owned (+1) */
  ScrWsConn *conn;    /* owned */
  ScrWsClientCallbacks cb;
  void *user;
  int ready;
  /* The socket outlives us only if the loop is mid-callback; `dead` stops
   * the reader from driving a torn-down conn. */
  bool dead;
  /* Non-zero while scr_ws_conn_recv/eof is on the stack. A free that
   * lands from inside a message callback -- the program dropped its
   * last reference to the socket there -- must not pull the conn out
   * from under the parser that is still walking the read buffer, so it
   * waits for the frame to finish. */
  int depth;
  bool want_free;
};

static void wsc_free_now(ScrWsClient *c);

/* ── the two directions ─────────────────────────────────────────────── */

static void wsc_want_write(void *u, const uint8_t *data, size_t len) {
  ScrWsClient *c = u;
  if (c->dead || c->sock == NULL) return;
  scr_net_sock_write_native(c->sock, (const char *)data, len);
}

static void wsc_data(void *ctx, const char *buf, size_t n) {
  ScrWsClient *c = ctx;
  if (c->dead) return;
  c->depth++;
  /* recv answers false once the conn is finished with the stream — a
   * protocol error it has already reported, or a close it has replied to.
   * Either way there is nothing further to feed it. */
  if (!scr_ws_conn_recv(c->conn, (const uint8_t *)buf, n)) c->dead = true;
  if (--c->depth == 0 && c->want_free) wsc_free_now(c);
}

/* THE FAILURE PATH: the stream ended, or the transport reported an
 * error, without a completed closing handshake. Both spellings are one
 * thing to the API -- "fail the WebSocket connection": an `error`
 * event and then the abnormal close 1006, with readyState already
 * CLOSED when the error listener runs. Measured against Node 25's
 * undici on three shapes: a refused dial (error + close 1006), a server
 * that answers a close frame with a reset (error + close 1006), and a
 * completed close handshake (neither -- wsc_on_close already moved
 * ready to CLOSED, which is what silences this).
 *
 * The error hook also has to EXIST: scr_net raises Node's
 * unhandled-'error'-event abort for a socket with no listener list of
 * its own, so before this a WebSocket to a closed port killed the
 * process instead of reporting. */
static void wsc_fail(ScrWsClient *c, const char *msg) {
  if (c->dead || c->ready == SCR_WS_CLOSED) return;
  bool connecting = c->ready == SCR_WS_CONNECTING;
  c->ready = SCR_WS_CLOSED;
  if (c->cb.on_error) c->cb.on_error(c->user, msg);
  if (connecting) {
    /* The conn never opened, so its own EOF path stays silent; the
     * abnormal close is ours to report. */
    c->dead = true;
    if (c->cb.on_close) c->cb.on_close(c->user, 1006, NULL, 0);
  } else {
    scr_ws_conn_eof(c->conn);
  }
}

static bool wsc_err(void *ctx, ScrStr *msg) {
  ScrWsClient *c = ctx;
  if (c->dead) return true;
  c->depth++;
  wsc_fail(c, msg != NULL ? msg->data : "socket error");
  if (--c->depth == 0 && c->want_free) wsc_free_now(c);
  return true; /* consumed */
}

static void wsc_eof(void *ctx) {
  ScrWsClient *c = ctx;
  if (c->dead) return;
  c->depth++;
  wsc_fail(c, "socket hang up");
  if (--c->depth == 0 && c->want_free) wsc_free_now(c);
}

/* ── the conn's events, forwarded ───────────────────────────────────── */

static void wsc_on_open(void *u) {
  ScrWsClient *c = u;
  c->ready = SCR_WS_OPEN;
  if (c->cb.on_open) c->cb.on_open(c->user);
}

static void wsc_on_message(void *u, const uint8_t *d, size_t n, bool is_text) {
  ScrWsClient *c = u;
  if (c->cb.on_message) c->cb.on_message(c->user, d, n, is_text);
}

static void wsc_on_close(void *u, uint16_t code, const uint8_t *reason, size_t rlen) {
  ScrWsClient *c = u;
  c->ready = SCR_WS_CLOSED;
  if (c->cb.on_close) c->cb.on_close(c->user, code, reason, rlen);
}

static void wsc_on_error(void *u, const char *msg) {
  ScrWsClient *c = u;
  if (c->cb.on_error) c->cb.on_error(c->user, msg);
}

/* ── dialing ────────────────────────────────────────────────────────── */

/* scr_throw_error_named MOVES both strings into the error object (see
 * its comment) -- releasing them here was a double free, and the unit was
 * never linked into a program, so nothing had run it. */
static void wsc_throw(const char *msg) {
  scr_throw_error_named(scr_str_new("SyntaxError", 11), scr_str_new(msg, strlen(msg)));
}

ScrWsClient *scr_ws_client_connect(ScrStr *url, ScrStr *protocols,
                                   const ScrWsClientCallbacks *cb, void *user,
                                   const ScrWsTlsOps *tls) {
  ScrUrl *u = scr_url_new(url); /* throws "Invalid URL" itself */
  if (u == NULL) return NULL;

  bool secure;
  if (u->scheme->len == 3 && memcmp(u->scheme->data, "wss", 3) == 0) secure = true;
  else if (u->scheme->len == 2 && memcmp(u->scheme->data, "ws", 2) == 0) secure = false;
  else {
    scr_url_release(u);
    wsc_throw("expected a ws: or wss: url");
    return NULL;
  }
  if (secure && (tls == NULL || tls->wrap == NULL)) {
    scr_url_release(u);
    wsc_throw("wss: is not supported in this binary (no TLS transport linked)");
    return NULL;
  }

  double port = u->port->len > 0 ? (double)atoi(u->port->data) : (secure ? 443 : 80);

  /* The request line wants path+query; "" means "/" as it does for HTTP. */
  size_t plen = u->path->len + u->query->len;
  char *pbuf = malloc(plen + 2);
  if (pbuf == NULL) {
    scr_url_release(u);
    return NULL;
  }
  size_t pn = 0;
  if (u->path->len == 0) pbuf[pn++] = '/';
  else {
    memcpy(pbuf, u->path->data, u->path->len);
    pn = u->path->len;
  }
  memcpy(pbuf + pn, u->query->data, u->query->len);
  pn += u->query->len;
  pbuf[pn] = '\0';

  /* Host header carries the authority as written (port included when it
   * is not the scheme's default) — the dial resolves separately. */
  char hostbuf[300];
  size_t hn = u->host->len < sizeof hostbuf - 8 ? u->host->len : sizeof hostbuf - 8;
  memcpy(hostbuf, u->host->data, hn);
  if (u->port->len > 0 && hn + 1 + u->port->len < sizeof hostbuf) {
    hostbuf[hn++] = ':';
    memcpy(hostbuf + hn, u->port->data, u->port->len);
    hn += u->port->len;
  }
  hostbuf[hn] = '\0';

  ScrWsClient *c = calloc(1, sizeof *c);
  if (c == NULL) {
    free(pbuf);
    scr_url_release(u);
    return NULL;
  }
  c->cb = *cb;
  c->user = user;
  c->ready = SCR_WS_CONNECTING;

  /* The nonce and the accept value it obliges the server to echo. */
  uint8_t seed[16];
  arc4random_buf(seed, sizeof seed);
  char key_b64[25];
  scr_ws_key_b64(seed, key_b64);
  char accept[29];
  scr_ws_accept_key(key_b64, 24, accept);

  uint8_t mask_seed[4];
  arc4random_buf(mask_seed, sizeof mask_seed);

  static const ScrWsCallbacks conn_cb = {
      .on_open = &wsc_on_open,
      .on_message = &wsc_on_message,
      .on_close = &wsc_on_close,
      .on_error = &wsc_on_error,
      .want_write = &wsc_want_write,
  };
  c->conn = scr_ws_conn_new(accept, &conn_cb, c, mask_seed);
  if (c->conn == NULL) {
    free(pbuf);
    free(c);
    scr_url_release(u);
    return NULL;
  }

  ScrStr *dial = scr_net_blocking_lookup(u->host);
  c->sock = scr_net_connect(port, dial, NULL);
  scr_str_release(dial);

  scr_net_sock_set_native_reader(c->sock, &wsc_data, &wsc_eof, &wsc_eof, c, NULL);
  scr_net_sock_set_native_events(c->sock, NULL, &wsc_err);

  /* TLS wraps the dialed socket before any bytes go out; everything below
   * buffers until its handshake ends — the ordering scr_http.c relies on. */
  if (secure) tls->wrap(c->sock, tls->ctx != NULL ? tls->ctx(u->host, true) : NULL);

  char *req = malloc(pn + hn + 512 + (protocols ? protocols->len : 0));
  if (req != NULL) {
    size_t rn = scr_ws_build_request(req, pn + hn + 512 + (protocols ? protocols->len : 0),
                                     hostbuf, pbuf, key_b64,
                                     protocols != NULL ? protocols->data : NULL);
    scr_net_sock_write_native(c->sock, req, rn);
    free(req);
  }

  free(pbuf);
  scr_url_release(u);
  return c;
}

/* ── the caller's side ──────────────────────────────────────────────── */

void scr_ws_client_send(ScrWsClient *c, const uint8_t *data, size_t len, bool is_text) {
  if (c == NULL || c->dead) return;
  scr_ws_conn_send(c->conn, data, len, is_text);
}

void scr_ws_client_close(ScrWsClient *c, uint16_t code, const uint8_t *reason, size_t reason_len) {
  if (c == NULL || c->dead) return;
  if (c->ready == SCR_WS_CONNECTING || c->ready == SCR_WS_OPEN) c->ready = SCR_WS_CLOSING;
  scr_ws_conn_close(c->conn, code, reason, reason_len);
}

int scr_ws_client_ready_state(const ScrWsClient *c) {
  return c == NULL ? SCR_WS_CLOSED : c->ready;
}

static void wsc_free_now(ScrWsClient *c) {
  if (c->sock != NULL) {
    scr_net_sock_clear_native_reader(c->sock);
    scr_net_sock_release(c->sock);
    c->sock = NULL;
  }
  scr_ws_conn_free(c->conn);
  c->conn = NULL;
  free(c);
}

void scr_ws_client_free(ScrWsClient *c) {
  if (c == NULL) return;
  c->dead = true;
  if (c->depth > 0) {
    c->want_free = true; /* the parser above us is still reading */
    return;
  }
  wsc_free_now(c);
}
