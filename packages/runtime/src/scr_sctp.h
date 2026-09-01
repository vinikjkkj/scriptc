/* scr_sctp.h — the SCTP packet layer's contract.
 *
 * Wire format only: build and parse. No association state machine, no
 * timers, no socket. scr_sctp.c's header says why that split is where it
 * is and which parts of SCTP this workload does NOT need.
 *
 * Every builder returns bytes written INCLUDING the 4-byte padding, or 0
 * when the buffer is too small. Zero is unambiguous — no chunk is ever
 * empty. Every parser returns false on a malformed or truncated input
 * and writes nothing.
 *
 * Parsers return BORROWED pointers into the caller's packet buffer.
 * Nothing here allocates, and no returned pointer outlives the datagram
 * it came from.
 */

#ifndef SCR_SCTP_H
#define SCR_SCTP_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* RFC 4960 s3.1: source port, dest port, verification tag, checksum. */
#define SCR_SCTP_HEADER_LEN 12u
/* RFC 4960 s3.2: type, flags, length. */
#define SCR_SCTP_CHUNK_HDR_LEN 4u

/* Chunk types (RFC 4960 s3.2). Only the ones this path can meet are
 * named; an unknown type is reported by number and handled by the
 * caller's default rule. */
#define SCR_SCTP_CHUNK_DATA 0u
#define SCR_SCTP_CHUNK_INIT 1u
#define SCR_SCTP_CHUNK_INIT_ACK 2u
#define SCR_SCTP_CHUNK_SACK 3u
#define SCR_SCTP_CHUNK_HEARTBEAT 4u
#define SCR_SCTP_CHUNK_HEARTBEAT_ACK 5u
#define SCR_SCTP_CHUNK_ABORT 6u
#define SCR_SCTP_CHUNK_SHUTDOWN 7u
#define SCR_SCTP_CHUNK_SHUTDOWN_ACK 8u
#define SCR_SCTP_CHUNK_ERROR 9u
#define SCR_SCTP_CHUNK_COOKIE_ECHO 10u
#define SCR_SCTP_CHUNK_COOKIE_ACK 11u
#define SCR_SCTP_CHUNK_SHUTDOWN_COMPLETE 14u

/* DATA chunk flags (RFC 4960 s3.3.1). */
#define SCR_SCTP_DATA_FLAG_E 0x01u /* last fragment */
#define SCR_SCTP_DATA_FLAG_B 0x02u /* first fragment */
#define SCR_SCTP_DATA_FLAG_U 0x04u /* unordered */

/* Variable parameter types (RFC 4960 s3.3.2.1). */
#define SCR_SCTP_PARAM_STATE_COOKIE 7u

/* Payload Protocol Identifiers (RFC 8831 s8). 50 carries DCEP itself;
 * 53 is the binary payload zapo sends, which is why binaryType is
 * 'arraybuffer' on its channel. */
#define SCR_SCTP_PPID_DCEP 50u
#define SCR_SCTP_PPID_STRING 51u
#define SCR_SCTP_PPID_BINARY 53u
#define SCR_SCTP_PPID_STRING_EMPTY 56u
#define SCR_SCTP_PPID_BINARY_EMPTY 57u

/* DCEP message types (RFC 8832 s5). */
#define SCR_SCTP_DCEP_DATA_CHANNEL_ACK 0x02u
#define SCR_SCTP_DCEP_DATA_CHANNEL_OPEN 0x03u

/* DCEP channel types (RFC 8832 s5.1). zapo's { ordered: false } with no
 * maxRetransmits and no maxPacketLifeTime is exactly RELIABLE_UNORDERED. */
#define SCR_SCTP_DCEP_RELIABLE 0x00u
#define SCR_SCTP_DCEP_RELIABLE_UNORDERED 0x80u

typedef struct {
  uint16_t src_port;
  uint16_t dst_port;
  uint32_t vtag;
  uint32_t checksum;
} ScrSctpHeader;

/* A cursor over the chunks of one datagram. `value` borrows into the
 * packet; `value_len` EXCLUDES the 4-byte chunk header and any padding. */
typedef struct {
  const uint8_t *pkt;
  size_t len;
  size_t off;
  uint8_t type;
  uint8_t flags;
  const uint8_t *value;
  size_t value_len;
} ScrSctpChunkIter;

typedef struct {
  uint32_t init_tag;
  uint32_t a_rwnd;
  uint16_t out_streams;
  uint16_t in_streams;
  uint32_t initial_tsn;
  /* Borrowed. NULL when the INIT ACK carried no State Cookie, which is
   * itself a protocol error the caller must decide about. */
  const uint8_t *cookie;
  size_t cookie_len;
} ScrSctpInitAck;

typedef struct {
  uint32_t tsn;
  uint16_t stream_id;
  uint16_t stream_seq;
  uint32_t ppid;
  const uint8_t *payload; /* borrowed */
  size_t payload_len;
} ScrSctpData;

/* ── checksum ─────────────────────────────────────────────────────── */

/* CRC32c, RFC 3309. Standalone so it can be known-answer tested on its
 * own; crc32c("123456789") is 0xE3069283. */
uint32_t scr_sctp_crc32c(const uint8_t *data, size_t len);

/* Round up to the 4-byte chunk boundary. */
size_t scr_sctp_pad4(size_t n);

/* ── header ───────────────────────────────────────────────────────── */

size_t scr_sctp_write_header(uint8_t *out, size_t cap, uint16_t src_port,
                             uint16_t dst_port, uint32_t vtag);
bool scr_sctp_read_header(const uint8_t *pkt, size_t len, ScrSctpHeader *out);

/* Compute and install the checksum over a fully assembled datagram.
 * Call once, last. */
void scr_sctp_finalize(uint8_t *pkt, size_t len);

/* True when the datagram's checksum matches. Does not mutate `pkt`. */
bool scr_sctp_verify(const uint8_t *pkt, size_t len);

/* ── chunks ───────────────────────────────────────────────────────── */

bool scr_sctp_chunk_first(const uint8_t *pkt, size_t len,
                          ScrSctpChunkIter *it);
bool scr_sctp_chunk_next(ScrSctpChunkIter *it);

size_t scr_sctp_write_init(uint8_t *out, size_t cap, uint32_t init_tag,
                           uint32_t a_rwnd, uint16_t out_streams,
                           uint16_t in_streams, uint32_t initial_tsn);
bool scr_sctp_read_init_ack(const uint8_t *value, size_t value_len,
                            ScrSctpInitAck *out);
size_t scr_sctp_write_cookie_echo(uint8_t *out, size_t cap,
                                  const uint8_t *cookie, size_t cookie_len);
size_t scr_sctp_write_cookie_ack(uint8_t *out, size_t cap);
size_t scr_sctp_write_data(uint8_t *out, size_t cap, uint32_t tsn,
                           uint16_t stream_id, uint32_t ppid,
                           const uint8_t *payload, size_t payload_len,
                           bool unordered, bool beginning, bool ending);
bool scr_sctp_read_data(const uint8_t *value, size_t value_len,
                        ScrSctpData *out);
size_t scr_sctp_write_sack(uint8_t *out, size_t cap, uint32_t cum_tsn_ack,
                           uint32_t a_rwnd);
size_t scr_sctp_write_heartbeat_ack(uint8_t *out, size_t cap,
                                    const uint8_t *info, size_t info_len);

/* ── DCEP (RFC 8832) ──────────────────────────────────────────────────
 * Rides as the payload of a DATA chunk with PPID 50. Returns bytes
 * written, UNPADDED: the enclosing DATA chunk's padding covers it, and
 * padding here would be read by the peer as protocol-string bytes. */
size_t scr_sctp_write_dcep_open(uint8_t *out, size_t cap, uint8_t channel_type,
                                uint16_t priority, uint32_t reliability,
                                const char *label, size_t label_len,
                                const char *protocol, size_t protocol_len);
bool scr_sctp_is_dcep_ack(const uint8_t *payload, size_t len);

#endif /* SCR_SCTP_H */
