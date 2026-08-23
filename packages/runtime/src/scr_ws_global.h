/* `globalThis.WebSocket` — see scr_ws_global.c for the lifetime rules.
 *
 * The emitted program owns the API object (a record whose shape its own
 * types decide); this unit owns the socket, and — while the socket can
 * still fire — the object too, the way the platform does in JS. The two
 * meet at ONE plain function pointer rather than a ScrClosure: the
 * dispatch needs no capture, and a closure here would only add a second
 * edge into the same deliberate cycle.
 */
#ifndef SCR_WS_GLOBAL_H
#define SCR_WS_GLOBAL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "scr_runtime.h"
/* ScrWsClient and its callback table appear in the DELEGATED transport's
 * seam below, so this header carries the client's rather than leaving
 * every includer to guess the order. */
#include "scr_ws_client.h"

typedef struct ScrWsGlobal ScrWsGlobal;

/* `which` — what the dispatch is being told. */
#define SCR_WSG_OPEN 0
#define SCR_WSG_MESSAGE 1
#define SCR_WSG_CLOSE 2
#define SCR_WSG_ERROR 3
/* readyState changed with no event attached (close() moving CONNECTING/
 * OPEN to CLOSING). The record's readyState field is a plain slot, so
 * the emitted thunk writes it on EVERY dispatch — this arm exists so a
 * transition with no DOM event still reaches it. */
#define SCR_WSG_STATE 4

/* The compiler-emitted dispatch. `user` is the API record, BORROWED and
 * never retained (see the header note); `state` is the readyState to
 * write before dispatching. For MESSAGE, `data`/`len`/`is_text` carry
 * the frame; for CLOSE, `code`/`text`/`text_len`/`was_clean` the close
 * info; for ERROR, `text` the message. Every pointer is borrowed and
 * valid only for the duration of the call. */
typedef void (*ScrWsGlobalFire)(void *user, int which, int state,
                                const uint8_t *data /*nullable*/, size_t len, bool is_text,
                                int code, const char *text /*nullable*/, size_t text_len,
                                bool was_clean);

/* Dial `url` (ws:// or wss://) with the handshake already in flight on
 * return. `protocols` is the Sec-WebSocket-Protocol value or NULL.
 * `headers` is the init bag's header block ("Name: value\r\n" lines) or
 * NULL. +1, or NULL with an exception pending (a bad URL, a non-ws
 * scheme). Callbacks cannot fire before scr_ws_global_set_user names the
 * record. */
ScrWsGlobal *scr_ws_global_new(ScrStr *url /*borrowed*/, ScrStr *protocols /*borrowed, nullable*/,
                               ScrStr *headers /*borrowed, nullable*/,
                               ScrWsGlobalFire fire);

/* ── the DELEGATED transport (an init-bag `dispatcher`) ──────────────
 *
 * A bag carrying a dispatcher does not dial: scr_ws_dispatch.c hands the
 * upgrade to the program and gets a socket back. That unit is gated
 * separately (a WebSocket program that never mentions a dispatcher must
 * not carry it), so the two may not name each other's symbols -- the
 * ScrWsTlsOps seam one file over, one level up. The DISPATCH unit drives:
 * it mints the handle here, builds its own state, and adopts.
 */
typedef struct {
  /* The owner is going away: drop the client and refuse late callbacks. */
  void (*invalidate)(void *disp);
  void (*release)(void *disp);
} ScrWsDispOps;

/* A handle with no transport yet. `fire` cannot be called before
 * scr_ws_global_adopt names one. +1. */
ScrWsGlobal *scr_ws_global_new_detached(ScrWsGlobalFire fire);

/* Give the handle the client the delegation built, and the state that
 * owns it. `disp`/`ops` MOVE IN (the handle releases through ops at
 * teardown); `c` stays owned by `disp`, so this handle will NOT free it
 * directly. */
void scr_ws_global_adopt(ScrWsGlobal *g, ScrWsClient *c /*borrowed*/, void *disp,
                         const ScrWsDispOps *ops);

/* The four callbacks a delegated client must be built with, so both
 * transports reach this unit's state machine through one code path. */
const ScrWsClientCallbacks *scr_ws_global_client_cbs(void);

/* `{ headers: { Name: value } }` from the init bag, flattened into the
 * request block scr_ws_build_request appends. The map is the header
 * record's string-keyed overflow map; entries whose name the handshake
 * owns (Host, Upgrade, Connection, Sec-WebSocket-*) are DROPPED rather
 * than duplicated, which is what undici does with the same bag. +1, and
 * NULL for an empty map (no block at all, not an empty one). */
ScrStr *scr_ws_headers_block(const ScrMap *headers /*borrowed, nullable*/);
/* Hand the handle its API record. The reference is STRONG for as long
 * as the socket can still fire (see the .c) -- `retain`/`release` are
 * the record shape's own _v adapters, which only the emitted code
 * knows. Callbacks cannot fire before this returns. */
void scr_ws_global_set_user(ScrWsGlobal *g, void *user, void *(*retain)(void *),
                             void (*release)(void *));

/* The MESSAGE event's `data`: a string for a text frame, an ArrayBuffer
 * for a binary one under binaryType 'arraybuffer'. Under 'blob' (the
 * default) it takes the deferred SC2020 fence and answers undefined with
 * the exception pending -- a Blob is not a value this runtime has, and
 * substituting an ArrayBuffer would be a silent divergence. */
ScrDyn *scr_ws_global_message_data(const ScrStr *binary_type /*borrowed, nullable*/,
                                    const uint8_t *d, size_t n, bool is_text);

/* send(): throws the WebSocket API's InvalidStateError while CONNECTING,
 * like the browser and Node's global — scr_ws_client would buffer. */
void scr_ws_global_send_str(ScrWsGlobal *g, const ScrStr *s /*borrowed*/);
void scr_ws_global_send_bytes(ScrWsGlobal *g, const ScrBytes *b /*borrowed*/);

/* close(code?, reason?): WHATWG argument validation (InvalidAccessError /
 * SyntaxError) before anything reaches the wire. */
void scr_ws_global_close(ScrWsGlobal *g, bool has_code, double code,
                          const ScrStr *reason /*borrowed, nullable*/);

double scr_ws_global_ready_state(const ScrWsGlobal *g);

/* The handle box's RC entry points (scr_box_new_obj) — the send/close
 * closures share one box, so the last release tears the socket down. */
void *scr_ws_global_retain_v(void *p);
void scr_ws_global_release_v(void *p);
void scr_ws_global_free(ScrWsGlobal *g);

#endif /* SCR_WS_GLOBAL_H */
