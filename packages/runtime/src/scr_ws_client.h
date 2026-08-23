/* The WebSocket CLIENT: scr_websocket.c's protocol driver bolted onto a
 * real socket.
 *
 * scr_websocket.c is deliberately transport-agnostic — it parses frames,
 * checks the handshake and hands finished bytes to `want_write`, without
 * knowing what carries them. This file is the other half: it dials, wraps
 * wss:// in TLS the way the native fetch client does, and pumps the socket
 * both ways. Splitting it this way is what lets the protocol layer be
 * tested against a real `ws` server with no sockets in the picture
 * (test/websocket-interop.test.ts).
 *
 * Lifetime: the client owns its socket and its ScrWsConn. Callbacks fire
 * with the caller's `user` pointer and never during scr_ws_client_connect
 * itself — the earliest is on_open, from the event loop.
 */
#ifndef SCR_WS_CLIENT_H
#define SCR_WS_CLIENT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "scr_runtime.h"

typedef struct ScrWsClient ScrWsClient;

typedef struct {
  void (*on_open)(void *user);
  void (*on_message)(void *user, const uint8_t *data, size_t len, bool is_text);
  void (*on_close)(void *user, uint16_t code, const uint8_t *reason, size_t reason_len);
  /* Transport or protocol failure. A close always follows. */
  void (*on_error)(void *user, const char *msg);
} ScrWsClientCallbacks;

/* The TLS leg, supplied by the caller so this unit stays transport-free —
 * scr_tls.c is compiled only into TLS-using binaries, and a ws:// program
 * must not have to drag mbedTLS in to link. Same reasoning as the `wrap`
 * pair scr_http_request_ex takes; the emitted glue passes the ops when the
 * tls unit is linked, NULL otherwise (wss:// then fails as unsupported). */
typedef struct {
  void *(*ctx)(ScrStr *host /*borrowed*/, bool reject_unauthorized);
  void (*wrap)(ScrNetSocket *sock, void *ctx);
} ScrWsTlsOps;

/* Dial `url` (ws:// or wss://) and start the handshake. Returns NULL with
 * a pending exception if the URL is not a WebSocket URL. `protocols` is
 * the Sec-WebSocket-Protocol value, or NULL for none. `headers` is a block
 * of already-formed "Name: value\r\n" lines appended to the upgrade
 * request, or NULL for none -- see scr_ws_build_request. */
ScrWsClient *scr_ws_client_connect(ScrStr *url /*borrowed*/, ScrStr *protocols /*borrowed, nullable*/,
                                   ScrStr *headers /*borrowed, nullable*/,
                                   const ScrWsClientCallbacks *cb, void *user,
                                   const ScrWsTlsOps *tls /*nullable*/);

/* ── the DELEGATED transport (a proxy `dispatcher`) ──────────────────
 *
 * The oracle's init bag has one member this unit cannot honour by
 * dialling: `dispatcher`. Node hands the WHOLE upgrade to
 * `dispatcher.dispatch(opts, handler)` and the connection never reaches
 * the origin; the dispatcher performs the HTTP upgrade over whatever
 * transport it likes (a proxy CONNECT, typically) and gives the socket
 * back through `handler.onUpgrade(status, headers, socket)`.
 *
 * So the client needs a second way in: one where the DIAL and the
 * REQUEST are somebody else's, and only the response validation, the
 * frame pump and the state machine are ours. That is exactly the three
 * lines of scr_ws_client_connect either side of the dial, which is why
 * this is a split rather than a second implementation.
 *
 * The response head is FED back through scr_ws_client_feed rather than
 * assumed good: scr_ws_conn_recv drives the handshake before it parses
 * frames, so a delegated upgrade gets byte-for-byte the same validation
 * (status 101, Upgrade/Connection tokens, Sec-WebSocket-Accept against
 * the key WE generated) as a dialled one. A dispatcher that answers a
 * forged accept fails here, not later. */

/* A client with no socket yet: the conn driver is live and expecting the
 * handshake response, and nothing is written until scr_ws_client_attach.
 * `expected_accept` is scr_ws_accept_key's output for the key the caller
 * sent. +1; NULL on allocation failure. */
ScrWsClient *scr_ws_client_detached(const char *expected_accept,
                                    const ScrWsClientCallbacks *cb, void *user);

/* Adopt an already-connected socket (+1 taken on it). False when this
 * client already has one — a dispatcher that called onUpgrade twice. */
bool scr_ws_client_attach(ScrWsClient *c, ScrNetSocket *sock /*borrowed*/);

/* Feed received bytes as though they had arrived on the socket: the
 * response head a delegating dispatcher already read off the wire. */
void scr_ws_client_feed(ScrWsClient *c, const uint8_t *data, size_t len);

/* The delegated upgrade failed before any socket arrived (the
 * dispatcher's `onError`, or a shape this unit cannot drive). Takes the
 * same failure path a refused dial does: `error`, then close 1006. */
void scr_ws_client_fail(ScrWsClient *c, const char *msg);

/* True once a socket has been attached — the "did the dispatcher ever
 * answer" test the delegating unit needs at teardown. */
bool scr_ws_client_attached(const ScrWsClient *c);

/* Queue a message. Before the handshake completes these buffer, matching
 * what the browser does between CONNECTING and OPEN. */
void scr_ws_client_send(ScrWsClient *c, const uint8_t *data, size_t len, bool is_text);

void scr_ws_client_close(ScrWsClient *c, uint16_t code, const uint8_t *reason, size_t reason_len);

/* readyState, in the WebSocket API's numbering. */
#define SCR_WS_CONNECTING 0
#define SCR_WS_OPEN 1
#define SCR_WS_CLOSING 2
#define SCR_WS_CLOSED 3
int scr_ws_client_ready_state(const ScrWsClient *c);

void scr_ws_client_free(ScrWsClient *c);

#endif /* SCR_WS_CLIENT_H */
