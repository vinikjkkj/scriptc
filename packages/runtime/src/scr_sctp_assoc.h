/* scr_sctp_assoc.h — the SCTP association state machine.
 *
 * SANS-IO BY CONSTRUCTION. This unit never touches a socket, a clock or a
 * thread. Datagrams are handed in, datagrams are taken out, and time
 * arrives as a parameter. Three reasons, in order of how much they matter:
 *
 *   1. It can be driven over a DELIBERATELY LOSSY transport in a test. An
 *      association proved only over a transport that cannot lose anything
 *      is not proved at all -- the DTLS half of this clause already learned
 *      that lesson the expensive way.
 *   2. Time being a parameter means retransmission and heartbeat timing are
 *      tested at whatever rate the test likes, with no sleeping.
 *   3. Wiring to scr_dgram.c later is then a pump loop, not a rewrite.
 *
 * scr_sctp.c is the wire format underneath, proved separately against
 * RFC 3720 and RFC 4960 vectors.
 *
 * ── scope, from what zapo measurably does ────────────────────────────
 *
 * WaSctpRelay.ts is the OFFERER and opens exactly one channel:
 *
 *     pc.createDataChannel('wa-web-call', { ordered: false })
 *
 * with no maxRetransmits and no maxPacketLifeTime. So:
 *
 *   - CLIENT SIDE ONLY. This side sends INIT and COOKIE-ECHO; it never
 *     generates or validates a State Cookie of its own.
 *   - UNORDERED RELIABLE. Every DATA chunk sets the U bit, stream sequence
 *     numbers are sent as 0 and ignored on receive (RFC 4960 s6.6), and
 *     RFC 3758 partial reliability is NOT implemented because nothing asks
 *     for it.
 *   - ONE outbound stream plus DCEP on the same stream.
 *
 * ── what is deliberately NOT here, so nobody reads it as finished ────
 *
 *   - No congestion control. There is no cwnd, no ssthresh and no fast
 *     retransmit; the sender is rate-limited only by the retransmission
 *     timer. Acceptable against a single known relay on a LAN path, wrong
 *     for the open internet.
 *   - No fragmentation or bundling. One user message becomes one DATA
 *     chunk in one packet. zapo's SDP writes a=max-message-size:1500 and
 *     its buffer cap is 10 KB, so its messages fit, but a larger one is
 *     REFUSED rather than split.
 *   - Gap-ack blocks are PARSED but not acted on: retransmission is driven
 *     by the cumulative TSN and the timer only.
 *   - No graceful SHUTDOWN sequence; ABORT is recognised on receive.
 */
#ifndef SCR_SCTP_ASSOC_H
#define SCR_SCTP_ASSOC_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct ScrSctpAssoc ScrSctpAssoc;

typedef enum {
  SCR_SCTP_CLOSED = 0,
  SCR_SCTP_COOKIE_WAIT,   /* INIT sent, waiting for INIT ACK      */
  SCR_SCTP_COOKIE_ECHOED, /* COOKIE ECHO sent, waiting COOKIE ACK */
  SCR_SCTP_ESTABLISHED,
  SCR_SCTP_ABORTED
} ScrSctpState;

/* `now_ms` is the caller's clock, any monotonic origin. `seed` picks the
 * initiate tag and initial TSN; a real caller passes CSPRNG output, and a
 * test passes a constant so a failure can be replayed. */
ScrSctpAssoc *scr_sctp_assoc_new(uint16_t local_port, uint16_t remote_port,
                                 uint32_t seed, uint64_t now_ms);
void scr_sctp_assoc_free(ScrSctpAssoc *a);

ScrSctpState scr_sctp_assoc_state(const ScrSctpAssoc *a);

/* Begin the association: queues INIT. */
void scr_sctp_assoc_connect(ScrSctpAssoc *a, uint64_t now_ms);

/* Feed one received datagram. */
void scr_sctp_assoc_input(ScrSctpAssoc *a, const uint8_t *pkt, size_t len,
                          uint64_t now_ms);

/* Advance timers: retransmission and heartbeat. Call regularly. */
void scr_sctp_assoc_tick(ScrSctpAssoc *a, uint64_t now_ms);

/* Take the next datagram to transmit, or 0 when none is pending. */
size_t scr_sctp_assoc_pop_output(ScrSctpAssoc *a, uint8_t *buf, size_t cap);

/* Open the data channel (DCEP DATA_CHANNEL_OPEN, RFC 8832). Legal once
 * ESTABLISHED. Unordered reliable, which is channel type 0x80. */
bool scr_sctp_assoc_open_channel(ScrSctpAssoc *a, const char *label,
                                 uint64_t now_ms);
bool scr_sctp_assoc_channel_open(const ScrSctpAssoc *a);

/* Send one user message as unordered DATA with PPID 53. False when the
 * channel is not open or the message does not fit one chunk. */
bool scr_sctp_assoc_send(ScrSctpAssoc *a, const uint8_t *data, size_t len,
                         uint64_t now_ms);

/* Take the next received user message. Returns its length, or 0 when the
 * queue is empty. */
size_t scr_sctp_assoc_pop_message(ScrSctpAssoc *a, uint8_t *buf, size_t cap,
                                  uint32_t *ppid);

/* Counters, so a test can prove a path was EXERCISED rather than assume
 * it: a retransmission count of zero over a lossy transport means the test
 * did not test what it claims. */
typedef struct {
  uint32_t data_sent;
  uint32_t data_received;
  uint32_t retransmits;
  uint32_t sacks_received;
  uint32_t heartbeats_answered;
  uint32_t duplicates_dropped;
} ScrSctpStats;

void scr_sctp_assoc_stats(const ScrSctpAssoc *a, ScrSctpStats *out);

#endif /* SCR_SCTP_ASSOC_H */
