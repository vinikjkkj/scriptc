/* scr_wrtc.c — the WebRTC peer-connection and data-channel handles,
 * WIRED TO THE TRANSPORT.
 *
 * WHAT CHANGED. The previous revision of this file was the synchronous
 * state surface with nothing behind it: `iceConnectionState` answered
 * "new" honestly because nothing could ever move it, and `send` and the
 * offer/answer exchange refused by name. The ICE/DTLS/SCTP stack proved
 * elsewhere in this clause existed but was driven only by test harnesses.
 *
 * This joins them. scr_wrtc_conn.c owns the socket, the DTLS session and
 * the SCTP association; this file owns the JS-visible objects, and
 * scr_wrtc_dispatch -- called once per event-loop turn from
 * scr_async.c's scr_loop_set_wrtc hook -- pumps the transport with the
 * loop's clock and turns what comes back into events. So:
 *
 *   - createDataChannel returns a channel backed by the association,
 *   - readyState reaches "open" when DCEP opens it,
 *   - send actually sends,
 *   - onopen / onmessage fire from the loop,
 *   - the four on*statechange handlers are driven by real transitions.
 *
 * THE STRINGS ARE STILL THE CONTRACT, AND THEY ARE STILL CAPTURED. Every
 * literal below was read off node v25.9.0 running @roamhq/wrtc 0.10
 * (tests/perf/wrtc/oracle/). Four of them contradict either the
 * specification or an obvious guess, and the oracle wins every time:
 *
 *   - binaryType defaults to "arraybuffer", not the spec's "blob".
 *   - readyState after close() is "closing", not "closed".
 *   - pc.close() fires oniceconnectionstatechange, onconnectionstatechange
 *     and onsignalingstatechange, IN THAT ORDER, and does NOT fire
 *     onicegatheringstatechange.
 *   - send() on a channel that is not open throws InvalidStateError with
 *     the message "RTCDataChannel.readyState is not 'open'".
 *
 * And one member is deliberately NOT matched: the oracle's
 * RTCDataChannel.id is uninitialised memory read as a double -- a
 * different denormal on every run. It is refused rather than invented.
 *
 * WHAT HAS STILL NOT HAPPENED. Nothing in this clause has met a real
 * WebRTC peer. Every byte the transport under this file has exchanged was
 * exchanged with a hand-written SCTP peer that lives in this repository.
 */

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "scr_runtime.h"
#include "scr_wrtc_conn.h"

typedef enum { PC_STABLE = 0, PC_HAVE_LOCAL_OFFER, PC_CLOSED } PcSignaling;
typedef enum { DC_CONNECTING = 0, DC_OPEN, DC_CLOSING, DC_CLOSED } DcReady;

/* The two transport-derived states. They are separate enums from
 * ScrWrtcTrState because iceConnectionState and connectionState answer
 * DIFFERENTLY for the same transport state ("checking" vs "connecting"),
 * and collapsing them is how one of them ends up wrong. */
typedef enum { ICE_NEW = 0, ICE_CHECKING, ICE_CONNECTED, ICE_FAILED, ICE_CLOSED } IceConn;
typedef enum { CONN_NEW = 0, CONN_CONNECTING, CONN_CONNECTED, CONN_FAILED, CONN_CLOSED } PcConn;
typedef enum { GATHER_NEW = 0, GATHER_GATHERING, GATHER_COMPLETE } IceGather;

struct ScrRtcDataChannel {
  size_t rc;
  ScrStr *label;    /* owned */
  ScrStr *protocol; /* owned */
  bool ordered;
  DcReady ready;
  bool binary_arraybuffer;
  /* BORROWED, and nulled by the peer connection when it is freed: the
   * connection retains the channel, so the back-edge must not retain or
   * the pair is an uncollectable cycle. */
  struct ScrRtcPeerConnection *pc;
  ScrClosure *on_open, *on_close, *on_error, *on_message;
  ScrRtcMsgFn on_message_fn;
  bool emit_open;
};

struct ScrRtcPeerConnection {
  size_t rc;
  PcSignaling signaling;
  bool closed;
  ScrWrtcConn *tr;
  ScrRtcDataChannel *ch; /* owned (+1); zapo opens exactly one */
  IceConn ice;
  PcConn conn;
  IceGather gather;
  ScrClosure *on_ice, *on_conn, *on_gather, *on_signaling;
  bool emit_ice, emit_conn, emit_gather, emit_signaling;
  struct ScrRtcPeerConnection *next; /* registry */
  bool registered;
};

/* ── the registry the loop hook walks ────────────────────────────────── */

static ScrRtcPeerConnection *scr_rtc_live = NULL;
static bool scr_rtc_installed = false;

static void scr_rtc_register(ScrRtcPeerConnection *p) {
  if (p->registered) return;
  p->registered = true;
  p->next = scr_rtc_live;
  scr_rtc_live = p;
  scr_wrtc_install();
}

static void scr_rtc_unregister(ScrRtcPeerConnection *p) {
  if (!p->registered) return;
  ScrRtcPeerConnection **pp = &scr_rtc_live;
  while (*pp != NULL) {
    if (*pp == p) {
      *pp = p->next;
      break;
    }
    pp = &(*pp)->next;
  }
  p->registered = false;
  p->next = NULL;
}

/* ── RTCPeerConnection ───────────────────────────────────────────────── */

/* The configuration argument is accepted and ignored, which is honest for
 * exactly this workload: zapo passes `{ iceServers: [] }` -- empty -- so
 * there is no STUN or TURN server to record. A non-empty iceServers list
 * would need gathering that does not exist, and the LOWERING refuses that
 * case by name rather than dropping it here. */
ScrRtcPeerConnection *scr_rtc_peer_new(void) {
  ScrRtcPeerConnection *p = calloc(1, sizeof *p);
  if (p == NULL) return NULL;
  p->rc = 1;
  p->signaling = PC_STABLE;
  p->ice = ICE_NEW;
  p->conn = CONN_NEW;
  p->gather = GATHER_NEW;
  return p;
}

/* The socket and the DTLS identity are allocated on FIRST USE -- the first
 * createDataChannel or createOffer -- not in the constructor. A program
 * that constructs a peer connection and never offers (the shape the
 * lowered-surface differential compiles) then binds no socket and
 * generates no key, and its behaviour is unchanged from before this file
 * had a transport at all. */
static ScrWrtcConn *scr_rtc_transport(ScrRtcPeerConnection *p) {
  if (p == NULL || p->closed) return NULL;
  if (p->tr == NULL) {
    p->tr = scr_wrtc_conn_new();
    if (p->tr != NULL) scr_rtc_register(p);
  }
  return p->tr;
}

ScrRtcPeerConnection *scr_rtc_peer_connection_retain(ScrRtcPeerConnection *p) {
  if (p != NULL && p->rc != SIZE_MAX) p->rc++;
  return p;
}

static void scr_rtc_dc_detach(ScrRtcDataChannel *c);

void scr_rtc_peer_connection_release(ScrRtcPeerConnection *p) {
  if (p == NULL || p->rc == SIZE_MAX) return;
  if (--p->rc == 0) {
    scr_rtc_unregister(p);
    if (p->ch != NULL) {
      scr_rtc_dc_detach(p->ch);
      scr_rtc_data_channel_release(p->ch);
      p->ch = NULL;
    }
    if (p->tr != NULL) scr_wrtc_conn_free(p->tr);
    scr_closure_release(p->on_ice);
    scr_closure_release(p->on_conn);
    scr_closure_release(p->on_gather);
    scr_closure_release(p->on_signaling);
    free(p);
  }
}

void *scr_rtc_peer_connection_retain_v(void *p) {
  return scr_rtc_peer_connection_retain((ScrRtcPeerConnection *)p);
}

void scr_rtc_peer_connection_release_v(void *p) {
  scr_rtc_peer_connection_release((ScrRtcPeerConnection *)p);
}

ScrStr *scr_rtc_peer_signaling_state(ScrRtcPeerConnection *p) {
  if (p == NULL) return scr_str_new("closed", 6);
  switch (p->signaling) {
    case PC_CLOSED:
      return scr_str_new("closed", 6);
    case PC_HAVE_LOCAL_OFFER:
      return scr_str_new("have-local-offer", 16);
    default:
      return scr_str_new("stable", 6);
  }
}

ScrStr *scr_rtc_peer_ice_connection_state(ScrRtcPeerConnection *p) {
  if (p == NULL) return scr_str_new("closed", 6);
  switch (p->ice) {
    case ICE_CHECKING:
      return scr_str_new("checking", 8);
    case ICE_CONNECTED:
      return scr_str_new("connected", 9);
    case ICE_FAILED:
      return scr_str_new("failed", 6);
    case ICE_CLOSED:
      return scr_str_new("closed", 6);
    default:
      return scr_str_new("new", 3);
  }
}

ScrStr *scr_rtc_peer_ice_gathering_state(ScrRtcPeerConnection *p) {
  if (p == NULL) return scr_str_new("new", 3);
  switch (p->gather) {
    case GATHER_GATHERING:
      return scr_str_new("gathering", 9);
    case GATHER_COMPLETE:
      return scr_str_new("complete", 8);
    default:
      return scr_str_new("new", 3);
  }
}

ScrStr *scr_rtc_peer_connection_state(ScrRtcPeerConnection *p) {
  if (p == NULL) return scr_str_new("closed", 6);
  switch (p->conn) {
    case CONN_CONNECTING:
      return scr_str_new("connecting", 10);
    case CONN_CONNECTED:
      return scr_str_new("connected", 9);
    case CONN_FAILED:
      return scr_str_new("failed", 6);
    case CONN_CLOSED:
      return scr_str_new("closed", 6);
    default:
      return scr_str_new("new", 3);
  }
}

/* The close cascade, in the order the oracle fires it: ice, then
 * connection, then signaling -- and NOT gathering. Three separate
 * measurements, not one guess: rtc-events.ts against node v25.9.0 prints
 * exactly "ice fired / connection fired / signaling fired" and nothing
 * else, byte-identical across three runs. */
void scr_rtc_peer_close(ScrRtcPeerConnection *p) {
  if (p == NULL || p->closed) return;
  p->closed = true;
  if (p->tr != NULL) scr_wrtc_conn_close(p->tr);
  if (p->ice != ICE_CLOSED) {
    p->ice = ICE_CLOSED;
    p->emit_ice = true;
  }
  if (p->conn != CONN_CLOSED) {
    p->conn = CONN_CLOSED;
    p->emit_conn = true;
  }
  if (p->signaling != PC_CLOSED) {
    p->signaling = PC_CLOSED;
    p->emit_signaling = true;
  }
  /* A channel on a closed connection reads "closed", not "closing": it is
   * not being torn down gracefully, the transport under it is gone. */
  if (p->ch != NULL && p->ch->ready != DC_CLOSED) p->ch->ready = DC_CLOSED;
  if (!p->registered) scr_rtc_register(p); /* so the cascade still fires */
}

/* ── the offer/answer exchange ───────────────────────────────────────── */

ScrStr *scr_rtc_peer_create_offer(ScrRtcPeerConnection *p) {
  ScrWrtcConn *tr = scr_rtc_transport(p);
  if (tr == NULL) return scr_str_new("", 0);
  const char *sdp = scr_wrtc_conn_local_sdp(tr);
  return scr_str_new(sdp, strlen(sdp));
}

/* `setLocalDescription(desc)`. The description's TYPE is what arrives
 * here, and it is checked rather than ignored: the only local description
 * this connection can have is the offer it generated itself, so anything
 * but "offer" is refused loudly instead of silently setting the offer
 * anyway. */
ScrPromise *scr_rtc_peer_set_local_description(ScrRtcPeerConnection *p, ScrStr *type) {
  if (p == NULL) return scr_promise_settled_void();
  if (type != NULL && !(type->len == 5 && memcmp(type->data, "offer", 5) == 0)) {
    scr_throw_error_named(
        scr_str_new("InvalidStateError", 17),
        scr_str_new("setLocalDescription: only the offer this connection "
                    "created can be set as its local description",
                    91));
    /* The throw becomes the promise's REJECTION, which is what node does:
     * setLocalDescription answers a rejected promise, it does not throw
     * synchronously. scr_promise_settled_void moves the pending exception
     * in and resets the cell. */
    return scr_promise_settled_void();
  }
  ScrWrtcConn *tr = scr_rtc_transport(p);
  if (tr != NULL) (void)scr_wrtc_conn_local_sdp(tr); /* fix the credentials */
  if (p->signaling != PC_HAVE_LOCAL_OFFER) {
    p->signaling = PC_HAVE_LOCAL_OFFER;
    p->emit_signaling = true;
  }
  /* The host candidate is the socket already bound, so gathering is over
   * the moment the local description exists. There is no srflx or relay
   * candidate to wait for: iceServers is empty. */
  if (p->gather != GATHER_COMPLETE) {
    p->gather = GATHER_COMPLETE;
    p->emit_gather = true;
  }
  return scr_promise_settled_void();
}

ScrPromise *scr_rtc_peer_set_remote_description(ScrRtcPeerConnection *p, ScrStr *type,
                                                ScrStr *sdp) {
  if (p == NULL) return scr_promise_settled_void();
  if (type == NULL || !(type->len == 6 && memcmp(type->data, "answer", 6) == 0)) {
    scr_throw_error_named(
        scr_str_new("InvalidStateError", 17),
        scr_str_new("setRemoteDescription: only an answer has a lowering "
                    "(this side is the offerer)",
                    77));
    return scr_promise_settled_void();
  }
  ScrWrtcConn *tr = scr_rtc_transport(p);
  if (tr == NULL || sdp == NULL ||
      !scr_wrtc_conn_set_remote(tr, sdp->data, sdp->len)) {
    /* An answer with no a=fingerprint, or no candidate to send to, is not
     * a connection attempt with verification skipped -- it is a failure. */
    if (p->ice != ICE_FAILED) {
      p->ice = ICE_FAILED;
      p->emit_ice = true;
    }
    if (p->conn != CONN_FAILED) {
      p->conn = CONN_FAILED;
      p->emit_conn = true;
    }
    scr_throw_error_named(
        scr_str_new("InvalidAccessError", 18),
        scr_str_new("setRemoteDescription: the answer carries no usable "
                    "a=fingerprint and a=candidate pair",
                    84));
    return scr_promise_settled_void();
  }
  if (p->signaling != PC_STABLE) {
    p->signaling = PC_STABLE;
    p->emit_signaling = true;
  }
  if (p->ice != ICE_CHECKING) {
    p->ice = ICE_CHECKING;
    p->emit_ice = true;
  }
  if (p->conn != CONN_CONNECTING) {
    p->conn = CONN_CONNECTING;
    p->emit_conn = true;
  }
  return scr_promise_settled_void();
}

/* ── the four state-change handlers ──────────────────────────────────── */

static void scr_rtc_set_cb(ScrClosure **slot, ScrClosure *cb) {
  scr_closure_release(*slot);
  *slot = cb; /* MOVES the +1 in, the listener-list convention */
}

void scr_rtc_peer_on_ice_connection_state_change(ScrRtcPeerConnection *p, ScrClosure *cb) {
  if (p == NULL) {
    scr_closure_release(cb);
    return;
  }
  scr_rtc_set_cb(&p->on_ice, cb);
  scr_rtc_register(p);
}

void scr_rtc_peer_on_ice_gathering_state_change(ScrRtcPeerConnection *p, ScrClosure *cb) {
  if (p == NULL) {
    scr_closure_release(cb);
    return;
  }
  scr_rtc_set_cb(&p->on_gather, cb);
  scr_rtc_register(p);
}

void scr_rtc_peer_on_signaling_state_change(ScrRtcPeerConnection *p, ScrClosure *cb) {
  if (p == NULL) {
    scr_closure_release(cb);
    return;
  }
  scr_rtc_set_cb(&p->on_signaling, cb);
  scr_rtc_register(p);
}

void scr_rtc_peer_on_connection_state_change(ScrRtcPeerConnection *p, ScrClosure *cb) {
  if (p == NULL) {
    scr_closure_release(cb);
    return;
  }
  scr_rtc_set_cb(&p->on_conn, cb);
  scr_rtc_register(p);
}

/* ── RTCDataChannel ──────────────────────────────────────────────────── */

static void scr_rtc_dc_detach(ScrRtcDataChannel *c) {
  if (c != NULL) c->pc = NULL;
}

ScrRtcDataChannel *scr_rtc_peer_create_data_channel(ScrRtcPeerConnection *p,
                                                    ScrStr *label,
                                                    bool ordered) {
  ScrRtcDataChannel *c = calloc(1, sizeof *c);
  if (c == NULL) return NULL;
  c->rc = 1;
  c->label = label != NULL ? scr_str_retain(label) : scr_str_new("", 0);
  c->protocol = scr_str_new("", 0);
  c->ordered = ordered;
  c->ready = DC_CONNECTING;
  c->binary_arraybuffer = true; /* the oracle's default, not the spec's */
  c->pc = p;
  if (p != NULL) {
    ScrWrtcConn *tr = scr_rtc_transport(p);
    if (tr != NULL) scr_wrtc_conn_request_channel(tr, c->label->data);
    if (p->ch == NULL) {
      p->ch = scr_rtc_data_channel_retain(c);
    }
  }
  return c;
}

ScrRtcDataChannel *scr_rtc_data_channel_retain(ScrRtcDataChannel *c) {
  if (c != NULL && c->rc != SIZE_MAX) c->rc++;
  return c;
}

void scr_rtc_data_channel_release(ScrRtcDataChannel *c) {
  if (c == NULL || c->rc == SIZE_MAX) return;
  if (--c->rc == 0) {
    scr_str_release(c->label);
    scr_str_release(c->protocol);
    scr_closure_release(c->on_open);
    scr_closure_release(c->on_close);
    scr_closure_release(c->on_error);
    scr_closure_release(c->on_message);
    free(c);
  }
}

void *scr_rtc_data_channel_retain_v(void *p) {
  return scr_rtc_data_channel_retain((ScrRtcDataChannel *)p);
}

void scr_rtc_data_channel_release_v(void *p) {
  scr_rtc_data_channel_release((ScrRtcDataChannel *)p);
}

ScrStr *scr_rtc_dc_label(ScrRtcDataChannel *c) {
  return c != NULL ? scr_str_retain(c->label) : scr_str_new("", 0);
}

ScrStr *scr_rtc_dc_protocol(ScrRtcDataChannel *c) {
  return c != NULL ? scr_str_retain(c->protocol) : scr_str_new("", 0);
}

bool scr_rtc_dc_ordered(ScrRtcDataChannel *c) {
  return c != NULL && c->ordered;
}

double scr_rtc_dc_buffered_amount(ScrRtcDataChannel *c) {
  (void)c;
  return 0;
}

ScrStr *scr_rtc_dc_ready_state(ScrRtcDataChannel *c) {
  if (c == NULL) return scr_str_new("closed", 6);
  switch (c->ready) {
    case DC_OPEN:
      return scr_str_new("open", 4);
    case DC_CLOSING:
      return scr_str_new("closing", 7);
    case DC_CLOSED:
      return scr_str_new("closed", 6);
    default:
      return scr_str_new("connecting", 10);
  }
}

ScrStr *scr_rtc_dc_binary_type(ScrRtcDataChannel *c) {
  if (c != NULL && !c->binary_arraybuffer) return scr_str_new("blob", 4);
  return scr_str_new("arraybuffer", 11);
}

void scr_rtc_dc_set_binary_type(ScrRtcDataChannel *c, ScrStr *v) {
  if (c == NULL || v == NULL) return;
  /* Anything that is not "blob" leaves arraybuffer in place. The oracle
   * neither validates this nor throws, so neither does this. */
  c->binary_arraybuffer = !(v->len == 4 && memcmp(v->data, "blob", 4) == 0);
}

void scr_rtc_dc_close(ScrRtcDataChannel *c) {
  if (c == NULL) return;
  /* "closing", not "closed" -- captured from the oracle. Reporting
   * "closed" here would be a wrong answer, not a tidier one. */
  if (c->ready != DC_CLOSED) c->ready = DC_CLOSING;
}

void scr_rtc_dc_on_open(ScrRtcDataChannel *c, ScrClosure *cb) {
  if (c == NULL) {
    scr_closure_release(cb);
    return;
  }
  scr_rtc_set_cb(&c->on_open, cb);
}

void scr_rtc_dc_on_close(ScrRtcDataChannel *c, ScrClosure *cb) {
  if (c == NULL) {
    scr_closure_release(cb);
    return;
  }
  scr_rtc_set_cb(&c->on_close, cb);
}

void scr_rtc_dc_on_error(ScrRtcDataChannel *c, ScrClosure *cb) {
  if (c == NULL) {
    scr_closure_release(cb);
    return;
  }
  scr_rtc_set_cb(&c->on_error, cb);
}

void scr_rtc_dc_on_message(ScrRtcDataChannel *c, ScrClosure *cb, ScrRtcMsgFn fn) {
  if (c == NULL) {
    scr_closure_release(cb);
    return;
  }
  scr_rtc_set_cb(&c->on_message, cb);
  c->on_message_fn = fn;
}

void scr_rtc_msg_thunk0(ScrClosure *cb, ScrBytes *payload) {
  (void)payload;
  ((void (*)(ScrClosure *))cb->fn)(cb);
}

void scr_rtc_msg_thunk_bytes(ScrClosure *cb, ScrBytes *payload) {
  /* the listener owns its +1 param, the universal convention */
  ((void (*)(ScrClosure *, ScrBytes *))cb->fn)(cb, scr_bytes_retain(payload));
}

/* The send fence. Captured, not guessed: node v25.9.0 running
 * @roamhq/wrtc throws InvalidStateError with exactly this message both on
 * a 'connecting' channel and on one already closed. Answering `undefined`
 * quietly, or throwing a plain Error, would each be a wrong answer where
 * the differential can see it. */
static bool scr_rtc_dc_sendable(ScrRtcDataChannel *c) {
  if (c != NULL && c->ready == DC_OPEN && c->pc != NULL && c->pc->tr != NULL &&
      scr_wrtc_conn_channel_open(c->pc->tr))
    return true;
  scr_throw_error_named(scr_str_new("InvalidStateError", 17),
                        scr_str_new("RTCDataChannel.readyState is not 'open'", 39));
  return false;
}

void scr_rtc_dc_send_str(ScrRtcDataChannel *c, ScrStr *data) {
  if (!scr_rtc_dc_sendable(c)) return;
  if (!scr_wrtc_conn_send(c->pc->tr, (const uint8_t *)data->data, data->len,
                          (uint64_t)scr_now_ms())) {
    scr_throw_error_named(
        scr_str_new("OperationError", 14),
        scr_str_new("RTCDataChannel.send: the message does not fit one SCTP "
                    "DATA chunk (fragmentation has no lowering)",
                    96));
  }
}

void scr_rtc_dc_send_bytes(ScrRtcDataChannel *c, ScrBytes *data) {
  if (!scr_rtc_dc_sendable(c)) return;
  size_t n = data->len * scr_bytes_elem_size(data->elem);
  if (!scr_wrtc_conn_send(c->pc->tr, data->data, n, (uint64_t)scr_now_ms())) {
    scr_throw_error_named(
        scr_str_new("OperationError", 14),
        scr_str_new("RTCDataChannel.send: the message does not fit one SCTP "
                    "DATA chunk (fragmentation has no lowering)",
                    96));
  }
}

/* ── the loop station ────────────────────────────────────────────────── */

/* One pump per connection with the loop's clock, then whatever that
 * produced. The transport is sans-io, so this is genuinely a pump: it
 * hands over the time and takes back datagrams and messages. */
static void scr_rtc_pump_one(ScrRtcPeerConnection *p, uint64_t now) {
  if (p->tr == NULL) return;
  scr_wrtc_conn_pump(p->tr, now);

  ScrWrtcTrState st = scr_wrtc_conn_state(p->tr);
  IceConn ice = p->ice;
  PcConn conn = p->conn;
  if (!p->closed) {
    switch (st) {
      case SCR_WRTC_TR_CHECKING:
        ice = ICE_CHECKING;
        conn = CONN_CONNECTING;
        break;
      case SCR_WRTC_TR_CONNECTED:
        ice = ICE_CONNECTED;
        conn = CONN_CONNECTED;
        break;
      case SCR_WRTC_TR_FAILED:
        ice = ICE_FAILED;
        conn = CONN_FAILED;
        break;
      default:
        break;
    }
  }
  if (ice != p->ice) {
    p->ice = ice;
    p->emit_ice = true;
  }
  if (conn != p->conn) {
    p->conn = conn;
    p->emit_conn = true;
  }

  ScrRtcDataChannel *c = p->ch;
  if (c == NULL) return;
  if (c->ready == DC_CONNECTING && scr_wrtc_conn_channel_open(p->tr)) {
    c->ready = DC_OPEN;
    c->emit_open = true;
  }
  if (c->ready == DC_OPEN && st == SCR_WRTC_TR_FAILED) c->ready = DC_CLOSED;
}

static void scr_rtc_fire0(ScrClosure *cb) {
  if (cb != NULL && !scr_exc_pending()) ((void (*)(ScrClosure *))cb->fn)(cb);
}

static void scr_rtc_deliver_messages(ScrRtcPeerConnection *p) {
  ScrRtcDataChannel *c = p->ch;
  if (c == NULL || p->tr == NULL) return;
  uint8_t buf[2048];
  for (;;) {
    size_t n = scr_wrtc_conn_pop_message(p->tr, buf, sizeof buf);
    if (n == 0) break;
    if (c->on_message == NULL || c->on_message_fn == NULL || scr_exc_pending()) continue;
    ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, (double)n);
    if (b == NULL) return;
    memcpy(b->data, buf, n);
    c->on_message_fn(c->on_message, b);
    scr_bytes_release(b);
  }
}

static void scr_wrtc_dispatch(void) {
  uint64_t now = (uint64_t)scr_now_ms();
  for (ScrRtcPeerConnection *p = scr_rtc_live; p != NULL; p = p->next)
    scr_rtc_pump_one(p, now);

  /* The firing order is the oracle's, measured: ice, then connection,
   * then signaling. Gathering is fired last and only when it actually
   * moved -- pc.close() does NOT move it, which rtc-events.ts confirms by
   * printing three lines and not four. */
  for (ScrRtcPeerConnection *p = scr_rtc_live; p != NULL; p = p->next) {
    if (p->emit_ice) {
      p->emit_ice = false;
      scr_rtc_fire0(p->on_ice);
    }
    if (p->emit_conn) {
      p->emit_conn = false;
      scr_rtc_fire0(p->on_conn);
    }
    if (p->emit_signaling) {
      p->emit_signaling = false;
      scr_rtc_fire0(p->on_signaling);
    }
    if (p->emit_gather) {
      p->emit_gather = false;
      scr_rtc_fire0(p->on_gather);
    }
    ScrRtcDataChannel *c = p->ch;
    if (c != NULL && c->emit_open) {
      c->emit_open = false;
      scr_rtc_fire0(c->on_open);
    }
    scr_rtc_deliver_messages(p);
    if (scr_exc_pending()) return;
  }
}

/* Liveness, the scr_dgram.c contract: a connection with an answer applied
 * is unsettled work -- the handshake is in flight, or the channel is open
 * and a message may still arrive -- and a queued but unfired event is
 * work the program has not seen yet. A connection that has never been
 * given an answer holds nothing, which is why the lowered-surface
 * differential (construct, read, close) still exits immediately. */
static bool scr_wrtc_pending(void) {
  for (ScrRtcPeerConnection *p = scr_rtc_live; p != NULL; p = p->next) {
    if (p->emit_ice || p->emit_conn || p->emit_gather || p->emit_signaling) return true;
    if (p->ch != NULL && p->ch->emit_open) return true;
    if (p->tr != NULL && scr_wrtc_conn_pending(p->tr)) return true;
  }
  return false;
}

void scr_wrtc_install(void) {
  if (scr_rtc_installed) return;
  scr_rtc_installed = true;
  scr_loop_set_wrtc(&scr_wrtc_pending, &scr_wrtc_dispatch);
}
