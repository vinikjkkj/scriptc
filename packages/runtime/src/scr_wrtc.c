/* scr_wrtc.c — the WebRTC peer-connection and data-channel handles.
 *
 * WHAT THIS IS NOW. Stage 1 made these two types exist and refuse every
 * member by name. This gives them the SYNCHRONOUS STATE SURFACE: a peer
 * connection can be constructed, a data channel created from it, and every
 * property zapo reads answers a real value. The members that were
 * `SC2020 ... has no scriptc lowering yet` now lower.
 *
 * WHAT IT IS NOT, and the distinction is the whole point. Nothing here
 * touches the network. The ICE, DTLS and SCTP machinery proved elsewhere in
 * this clause (scr_wrtc_fp.c, scr_wrtc_cert.c, scr_sctp*.c) is NOT wired in
 * yet, so the transport states answer "new" honestly and the channel never
 * reaches "open" on its own. A member that reported "connected" here would
 * be a WRONG answer dressed as progress, which is worse than the refusal it
 * replaced.
 *
 * THE STRINGS ARE THE CONTRACT, AND THEY WERE CAPTURED, NOT ASSUMED. Every
 * literal below was read off node v25.9.0 running @roamhq/wrtc 0.10 (see
 * tests/perf/wrtc/oracle/). Two of them contradict the specification and the
 * oracle wins:
 *
 *   - binaryType defaults to "arraybuffer", not the spec's "blob".
 *   - readyState after close() is "closing", not "closed".
 *
 * And one member is deliberately NOT matched: the oracle's
 * RTCDataChannel.id is uninitialised memory read as a double -- a different
 * denormal on every run (2.95e-312, 4.78e-313, ...). The spec says id is
 * null until the channel is negotiated. This answers null. Matching the
 * oracle there would mean matching uninitialised memory.
 */

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "scr_runtime.h"

typedef enum { PC_STABLE = 0, PC_CLOSED } PcSignaling;
typedef enum { DC_CONNECTING = 0, DC_OPEN, DC_CLOSING, DC_CLOSED } DcReady;

struct ScrRtcPeerConnection {
  size_t rc;
  PcSignaling signaling;
  bool closed;
};

struct ScrRtcDataChannel {
  size_t rc;
  ScrStr *label;    /* owned */
  ScrStr *protocol; /* owned */
  bool ordered;
  DcReady ready;
  bool binary_arraybuffer;
};

/* ── RTCPeerConnection ───────────────────────────────────────────────── */

/* The configuration argument is accepted and ignored, which is honest for
 * exactly this workload: zapo passes `{ iceServers: [] }` -- empty -- so
 * there is no STUN or TURN server to record. A non-empty iceServers list
 * would need gathering that does not exist yet, and the lowering refuses
 * that case rather than accepting it here. */
ScrRtcPeerConnection *scr_rtc_peer_new(void) {
  ScrRtcPeerConnection *p = calloc(1, sizeof *p);
  if (p == NULL) return NULL;
  p->rc = 1;
  p->signaling = PC_STABLE;
  return p;
}

ScrRtcPeerConnection *scr_rtc_peer_connection_retain(ScrRtcPeerConnection *p) {
  if (p != NULL && p->rc != SIZE_MAX) p->rc++;
  return p;
}

void scr_rtc_peer_connection_release(ScrRtcPeerConnection *p) {
  if (p == NULL || p->rc == SIZE_MAX) return;
  if (--p->rc == 0) free(p);
}

void *scr_rtc_peer_connection_retain_v(void *p) {
  return scr_rtc_peer_connection_retain((ScrRtcPeerConnection *)p);
}

void scr_rtc_peer_connection_release_v(void *p) {
  scr_rtc_peer_connection_release((ScrRtcPeerConnection *)p);
}

ScrStr *scr_rtc_peer_signaling_state(ScrRtcPeerConnection *p) {
  if (p != NULL && p->signaling == PC_CLOSED) return scr_str_new("closed", 6);
  return scr_str_new("stable", 6);
}

/* The three transport states, each its own function rather than one shared
 * "new": when ICE lands they diverge, and only this file changes. */
ScrStr *scr_rtc_peer_ice_connection_state(ScrRtcPeerConnection *p) {
  (void)p;
  return scr_str_new("new", 3);
}

ScrStr *scr_rtc_peer_ice_gathering_state(ScrRtcPeerConnection *p) {
  (void)p;
  return scr_str_new("new", 3);
}

ScrStr *scr_rtc_peer_connection_state(ScrRtcPeerConnection *p) {
  (void)p;
  return scr_str_new("new", 3);
}

void scr_rtc_peer_close(ScrRtcPeerConnection *p) {
  if (p == NULL) return;
  p->signaling = PC_CLOSED;
  p->closed = true;
}

/* ── RTCDataChannel ──────────────────────────────────────────────────── */

ScrRtcDataChannel *scr_rtc_peer_create_data_channel(ScrRtcPeerConnection *p,
                                                    ScrStr *label,
                                                    bool ordered) {
  (void)p;
  ScrRtcDataChannel *c = calloc(1, sizeof *c);
  if (c == NULL) return NULL;
  c->rc = 1;
  c->label = label != NULL ? scr_str_retain(label) : scr_str_new("", 0);
  c->protocol = scr_str_new("", 0);
  c->ordered = ordered;
  c->ready = DC_CONNECTING;
  c->binary_arraybuffer = true; /* the oracle's default, not the spec's */
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
