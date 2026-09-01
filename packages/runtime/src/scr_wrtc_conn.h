/* scr_wrtc_conn.h — the WebRTC transport, joined and owned by the loop.
 *
 * This is the seam the two halves of this clause were built either side of.
 * scr_wrtc_cert.c/scr_wrtc_fp.c gave a DTLS identity and RFC 8122
 * authentication; scr_sctp.c/scr_sctp_assoc.c gave a wire format and a
 * SANS-IO association. Both were proved by test harnesses that owned their
 * own `while` loop. This unit is the same pump written as RUNTIME code:
 *
 *     socket --recvfrom--> mbedtls_ssl_read  --> scr_sctp_assoc_input
 *     socket <--sendto---- mbedtls_ssl_write <-- scr_sctp_assoc_pop_output
 *
 * and scr_wrtc.c drives it once per event-loop turn from the
 * scr_loop_set_wrtc hook, exactly as scr_dgram.c is driven from
 * scr_loop_set_dgram. The sans-io design is why that is a pump and not a
 * rewrite: `now_ms` was already a parameter, so the loop's clock simply
 * becomes the association's clock.
 *
 * ── the shape this serves, and nothing wider ─────────────────────────
 *
 * zapo is the OFFERER over a relay whose address the answer already names,
 * with `iceServers: []`. So:
 *
 *   - ONE host candidate, on one UDP socket. No STUN, no TURN, no
 *     candidate pairing and no trickle: the answer carries exactly one
 *     remote candidate and it is the only target there will ever be.
 *   - NO STUN CONNECTIVITY CHECK. This is a real omission and it is named
 *     rather than hidden: a browser would send a STUN binding request with
 *     the peer's ice-ufrag before promoting a pair. Against a relay that
 *     answers `a=setup:passive` and expects DTLS from the offerer, the
 *     DTLS ClientHello is what starts the exchange, and the fingerprint --
 *     not the ICE credentials -- is what authenticates it. zapo's own
 *     relay/stun.ts speaks STUN for the OTHER (FNA) path, in TypeScript.
 *   - DTLS CLIENT ONLY. The answer says `a=setup:passive`, which makes
 *     this side active, which is the DTLS client. A server role would need
 *     HelloVerifyRequest cookies and is not served.
 *
 * ── what has NOT happened, said here so nobody reads it off the code ──
 *
 * Nothing in this clause has met a real WebRTC peer. Every byte this unit
 * has exchanged was exchanged with a hand-written SCTP peer that lives in
 * this repository (tests/perf/wrtc/probes/sctp_peer.inc). Both sides being
 * ours is deliberate -- an implementation talking to itself can agree with
 * itself about a wire-format bug -- but it is not interoperability
 * evidence.
 */
#ifndef SCR_WRTC_CONN_H
#define SCR_WRTC_CONN_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct ScrWrtcConn ScrWrtcConn;

/* The transport's own view of where it has got to. scr_wrtc.c maps these
 * onto the four JS-visible state strings; they are deliberately NOT the
 * same enumeration, because `iceConnectionState` and `connectionState`
 * answer differently for the same transport state. */
typedef enum {
  SCR_WRTC_TR_NEW = 0,   /* socket bound, nothing sent                 */
  SCR_WRTC_TR_CHECKING,  /* remote answer applied, DTLS in flight      */
  SCR_WRTC_TR_CONNECTED, /* DTLS up, fingerprint verified, SCTP up     */
  SCR_WRTC_TR_FAILED,    /* fingerprint mismatch, or the budget expired */
  SCR_WRTC_TR_CLOSED
} ScrWrtcTrState;

/* Bind a host candidate and generate the DTLS identity. NULL on failure
 * (no socket, no entropy, no key). */
ScrWrtcConn *scr_wrtc_conn_new(void);
void scr_wrtc_conn_free(ScrWrtcConn *c);

ScrWrtcTrState scr_wrtc_conn_state(const ScrWrtcConn *c);

/* The local offer SDP. Owned by the connection, stable for its lifetime:
 * the ice-ufrag, ice-pwd and fingerprint in it are the ones the transport
 * will actually use, so regenerating it per call would hand out
 * credentials that do not match the socket. */
const char *scr_wrtc_conn_local_sdp(ScrWrtcConn *c);

/* Apply the remote answer: take its a=fingerprint (RFC 8122) and its first
 * a=candidate host address, then start the DTLS handshake toward it.
 * False when either is missing or unparseable -- an answer this side
 * cannot authenticate against is a failure, never a connection attempt
 * with verification skipped. */
bool scr_wrtc_conn_set_remote(ScrWrtcConn *c, const char *sdp, size_t len);

/* One event-loop turn's worth of work. Never blocks. */
void scr_wrtc_conn_pump(ScrWrtcConn *c, uint64_t now_ms);

/* True while the transport still owes the program something -- which is
 * what keeps the event loop alive, the scr_dgram.c contract. */
bool scr_wrtc_conn_pending(const ScrWrtcConn *c);

/* The data channel, once DCEP has opened it. */
bool scr_wrtc_conn_channel_open(const ScrWrtcConn *c);

/* Ask for the channel; legal before the association exists (it is opened
 * as soon as SCTP reaches ESTABLISHED). */
void scr_wrtc_conn_request_channel(ScrWrtcConn *c, const char *label);

/* Queue one outbound message. False when the channel is not open or the
 * message does not fit one DATA chunk (no fragmentation -- see
 * scr_sctp_assoc.h). */
bool scr_wrtc_conn_send(ScrWrtcConn *c, const uint8_t *data, size_t len,
                        uint64_t now_ms);

/* Take the next received message, or 0 when the queue is empty. */
size_t scr_wrtc_conn_pop_message(ScrWrtcConn *c, uint8_t *buf, size_t cap);

/* Diagnostics for the differential probes: how much actually moved. */
typedef struct {
  uint32_t datagrams_sent;
  uint32_t datagrams_received;
  uint32_t sctp_retransmits;
  uint32_t messages_sent;
  uint32_t messages_received;
  bool fingerprint_verified;
} ScrWrtcConnStats;

void scr_wrtc_conn_stats(const ScrWrtcConn *c, ScrWrtcConnStats *out);

/* Begin teardown. The socket closes and the loop stops being held. */
void scr_wrtc_conn_close(ScrWrtcConn *c);

#endif /* SCR_WRTC_CONN_H */
