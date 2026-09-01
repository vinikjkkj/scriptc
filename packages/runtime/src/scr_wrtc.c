/* scr_wrtc.c — the WebRTC data-channel handles.
 *
 * TYPES WITH NO VALUES, for now. `RTCPeerConnection` and `RTCDataChannel`
 * are mapped so that the SHAPES around them compile: zapo's
 * `WaSctpRelay.ts` declares
 *
 *     interface Connection {
 *         peerConnection: RTCPeerConnection | null
 *         channel: RTCDataChannel | null
 *         incomingChannels: RTCDataChannel[]
 *         ...
 *     }
 *     private connections = new Map<string, Connection>()
 *
 * and without a representation for the two handles the FIELD poisons the
 * record, the record poisons the Map, and the package does not compile at
 * all — which is a different and much worse thing than compiling with
 * eighteen honest refusals in it. Every MEMBER still refuses, by name,
 * through the standard-library fence (surfaces.ts's stdlibMemberFence);
 * nothing in the compiler constructs one of these yet, so in every program
 * that links this file the two pointers are always NULL and these six
 * functions are dead code.
 *
 * This is `ScrRequest`'s arrangement (scr_fetch_static.c) rather than
 * `ScrSqliteDb`'s: the ownership machinery — union arms, capture boxes,
 * array elements — stays uniform for the kind, at the cost of one refcount
 * word that is never allocated. Deliberately NOT a cycle-headered
 * allocation: neither handle owns an outward edge, so traceAdapterC
 * answers null for both and no container ever traces one.
 *
 * `incomingChannels` is why `rtcDataChannel` has an array-element
 * representation (SCR_ELEM_REF) where the sqlite handles have none.
 *
 * When the real stack lands — ICE over scr_dgram.c, DTLS over the vendored
 * mbedtls, then SCTP — these structs grow bodies and the retain/release
 * pair below becomes the genuine ownership boundary. The shape is chosen
 * so that day is an edit here, not a change to every exhaustive switch in
 * the backend.
 */

#include <stdlib.h>

#include "scr_runtime.h"

/* ── RTCPeerConnection ───────────────────────────────────────────────── */

struct ScrRtcPeerConnection {
  size_t rc;
};

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

/* ── RTCDataChannel ──────────────────────────────────────────────────── */

struct ScrRtcDataChannel {
  size_t rc;
};

ScrRtcDataChannel *scr_rtc_data_channel_retain(ScrRtcDataChannel *c) {
  if (c != NULL && c->rc != SIZE_MAX) c->rc++;
  return c;
}

void scr_rtc_data_channel_release(ScrRtcDataChannel *c) {
  if (c == NULL || c->rc == SIZE_MAX) return;
  if (--c->rc == 0) free(c);
}

void *scr_rtc_data_channel_retain_v(void *p) {
  return scr_rtc_data_channel_retain((ScrRtcDataChannel *)p);
}

void scr_rtc_data_channel_release_v(void *p) {
  scr_rtc_data_channel_release((ScrRtcDataChannel *)p);
}
