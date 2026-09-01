/* scr_sctp.c — the SCTP packet layer for the WebRTC data channel.
 *
 * SCOPE. This is the wire format only: build and parse, no association
 * state machine, no timers, no socket. That split is deliberate — the
 * packet layer is the part that can be proved correct offline against
 * published known answers, and it is the part everything else stands on.
 * A retransmission timer over a wrong CRC is not worth writing.
 *
 * WHAT THIS WORKLOAD NEEDS, measured rather than assumed. zapo's
 * WaSctpRelay.ts opens exactly one channel:
 *
 *     pc.createDataChannel('wa-web-call', { ordered: false })
 *
 * with NEITHER maxRetransmits NOR maxPacketLifeTime, and it is the
 * offerer. That fixes three things that would otherwise be open:
 *
 *   1. UNORDERED RELIABLE. Not partially reliable. So RFC 3758
 *      FORWARD-TSN and the whole PR-SCTP extension are OUT — the single
 *      nastiest part of SCTP, and this workload does not ask for it.
 *      The DCEP channel type is 0x80 DATA_CHANNEL_RELIABLE_UNORDERED and
 *      the Reliability Parameter is 0.
 *   2. The DATA chunk's U bit is always set, so stream sequence numbers
 *      are ignored on receive and sent as 0 (RFC 4960 s6.6).
 *   3. Offerer, so this side sends INIT and COOKIE-ECHO and never has to
 *      generate or validate a State Cookie of its own.
 *
 * ENDIANNESS. SCTP is big-endian on the wire (RFC 4960 s3), with ONE
 * exception that has bitten every implementation ever written: the
 * checksum field carries the CRC32c in LITTLE-endian byte order
 * (RFC 3309). Both directions go through the same two helpers here so
 * the exception lives in exactly one place.
 *
 * References: RFC 4960 (SCTP), RFC 3309 (CRC32c checksum),
 * RFC 8831 (WebRTC data channels, PPIDs), RFC 8832 (DCEP).
 */

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "scr_sctp.h"

/* ── CRC32c (RFC 3309) ───────────────────────────────────────────────
 *
 * Castagnoli polynomial 0x1EDC6F41, used reflected as 0x82F63B78, init
 * 0xFFFFFFFF, final xor 0xFFFFFFFF. Table-free: a bitwise inner loop is
 * a few hundred nanoseconds per datagram at these sizes and costs no
 * 1 KiB of rodata in every binary that links this unit. If a profile
 * ever says otherwise the table is a drop-in replacement, because the
 * known answers below pin the RESULT, not the method. */

#define SCTP_CRC32C_POLY_REFLECTED 0x82F63B78u

/* The resumable core. Exposed internally so the checksum can be taken
 * over the header-with-a-zeroed-field and the untouched tail without
 * copying the whole datagram, and so there is exactly ONE copy of the
 * polynomial loop to get wrong. */
static uint32_t crc32c_update(uint32_t crc, const uint8_t *data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++) {
      /* The mask is 0xFFFFFFFF when the low bit is set, 0 otherwise. */
      uint32_t mask = (uint32_t)(-(int32_t)(crc & 1u));
      crc = (crc >> 1) ^ (SCTP_CRC32C_POLY_REFLECTED & mask);
    }
  }
  return crc;
}

uint32_t scr_sctp_crc32c(const uint8_t *data, size_t len) {
  return crc32c_update(0xFFFFFFFFu, data, len) ^ 0xFFFFFFFFu;
}

/* ── big-endian accessors ────────────────────────────────────────────
 * Written out rather than reaching for htonl: this unit must build
 * identically on win32 (where the byte-order headers differ) and must
 * not depend on the alignment of the caller's buffer. */

static void put_be16(uint8_t *p, uint16_t v) {
  p[0] = (uint8_t)(v >> 8);
  p[1] = (uint8_t)v;
}

static void put_be32(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)(v >> 24);
  p[1] = (uint8_t)(v >> 16);
  p[2] = (uint8_t)(v >> 8);
  p[3] = (uint8_t)v;
}

static uint16_t get_be16(const uint8_t *p) {
  return (uint16_t)(((uint16_t)p[0] << 8) | (uint16_t)p[1]);
}

static uint32_t get_be32(const uint8_t *p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
         ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}

/* The checksum field, and ONLY the checksum field, is little-endian
 * (RFC 3309 s3). Kept as its own pair so the exception is impossible to
 * apply by accident somewhere else. */
static void put_le32(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)v;
  p[1] = (uint8_t)(v >> 8);
  p[2] = (uint8_t)(v >> 16);
  p[3] = (uint8_t)(v >> 24);
}

static uint32_t get_le32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) |
         ((uint32_t)p[3] << 24);
}

/* Chunks are padded to a 4-byte boundary; the PADDING IS NOT COUNTED in
 * the chunk's length field (RFC 4960 s3.2), which is the single most
 * common off-by-N in SCTP parsers. */
size_t scr_sctp_pad4(size_t n) { return (n + 3u) & ~(size_t)3u; }

/* ── common header ───────────────────────────────────────────────── */

size_t scr_sctp_write_header(uint8_t *out, size_t cap, uint16_t src_port,
                             uint16_t dst_port, uint32_t vtag) {
  if (cap < SCR_SCTP_HEADER_LEN) return 0;
  put_be16(out + 0, src_port);
  put_be16(out + 2, dst_port);
  put_be32(out + 4, vtag);
  put_le32(out + 8, 0); /* checksum zeroed until finalise */
  return SCR_SCTP_HEADER_LEN;
}

bool scr_sctp_read_header(const uint8_t *pkt, size_t len,
                          ScrSctpHeader *out) {
  if (pkt == NULL || out == NULL || len < SCR_SCTP_HEADER_LEN) return false;
  out->src_port = get_be16(pkt + 0);
  out->dst_port = get_be16(pkt + 2);
  out->vtag = get_be32(pkt + 4);
  out->checksum = get_le32(pkt + 8);
  return true;
}

/* Zero the field, CRC the whole datagram, write the CRC back
 * little-endian. Both finalise and verify go through this so they cannot
 * disagree about the field's byte order. */
static uint32_t checksum_over(uint8_t *pkt, size_t len) {
  put_le32(pkt + 8, 0);
  return scr_sctp_crc32c(pkt, len);
}

void scr_sctp_finalize(uint8_t *pkt, size_t len) {
  if (pkt == NULL || len < SCR_SCTP_HEADER_LEN) return;
  uint32_t crc = checksum_over(pkt, len);
  put_le32(pkt + 8, crc);
}

bool scr_sctp_verify(const uint8_t *pkt, size_t len) {
  if (pkt == NULL || len < SCR_SCTP_HEADER_LEN) return false;
  uint32_t claimed = get_le32(pkt + 8);
  /* Recompute WITHOUT mutating the caller's buffer: the header is copied
   * so its checksum field can be zeroed, and the tail is CRC'd in place.
   * No whole-datagram scratch copy, and no write to a packet the caller
   * may hold const. */
  uint8_t hdr[SCR_SCTP_HEADER_LEN];
  memcpy(hdr, pkt, SCR_SCTP_HEADER_LEN);
  put_le32(hdr + 8, 0);
  uint32_t crc = crc32c_update(0xFFFFFFFFu, hdr, SCR_SCTP_HEADER_LEN);
  crc = crc32c_update(crc, pkt + SCR_SCTP_HEADER_LEN,
                      len - SCR_SCTP_HEADER_LEN);
  crc ^= 0xFFFFFFFFu;
  return crc == claimed;
}

/* ── chunk iteration ─────────────────────────────────────────────────
 *
 * Every length here is validated against the REMAINING buffer before it
 * is trusted. A chunk claiming a length shorter than its own 4-byte
 * header, or longer than what is left, ends the walk rather than
 * advancing by a bogus amount — an attacker-supplied datagram must not
 * be able to walk the cursor backwards or off the end. */

bool scr_sctp_chunk_first(const uint8_t *pkt, size_t len,
                          ScrSctpChunkIter *it) {
  if (pkt == NULL || it == NULL || len < SCR_SCTP_HEADER_LEN) return false;
  it->pkt = pkt;
  it->len = len;
  it->off = SCR_SCTP_HEADER_LEN;
  return scr_sctp_chunk_next(it);
}

bool scr_sctp_chunk_next(ScrSctpChunkIter *it) {
  if (it == NULL) return false;
  size_t off = it->off;
  if (off + SCR_SCTP_CHUNK_HDR_LEN > it->len) return false;

  uint16_t clen = get_be16(it->pkt + off + 2);
  /* A chunk length below the header size would make the walk loop
   * forever; a length past the end would read out of bounds. */
  if (clen < SCR_SCTP_CHUNK_HDR_LEN) return false;
  if (off + (size_t)clen > it->len) return false;

  it->type = it->pkt[off];
  it->flags = it->pkt[off + 1];
  it->value = it->pkt + off + SCR_SCTP_CHUNK_HDR_LEN;
  it->value_len = (size_t)clen - SCR_SCTP_CHUNK_HDR_LEN;

  /* Advance over the chunk PLUS its padding, which the length field
   * does not include. Padding on the final chunk may be absent. */
  size_t advance = scr_sctp_pad4((size_t)clen);
  if (off + advance > it->len) {
    it->off = it->len; /* consumed; next call ends the walk */
  } else {
    it->off = off + advance;
  }
  return true;
}

/* ── chunk builders ──────────────────────────────────────────────────
 *
 * Each returns the number of bytes written, or 0 when the buffer is too
 * small. 0 is unambiguous: no chunk is ever zero bytes. */

static size_t write_chunk_header(uint8_t *out, size_t cap, uint8_t type,
                                 uint8_t flags, size_t value_len) {
  size_t total = SCR_SCTP_CHUNK_HDR_LEN + value_len;
  if (total > 0xFFFFu) return 0;
  if (scr_sctp_pad4(total) > cap) return 0;
  out[0] = type;
  out[1] = flags;
  put_be16(out + 2, (uint16_t)total);
  return total;
}

/* Zero the padding rather than leaking whatever the caller's buffer
 * held: uninitialised padding is an information leak onto the wire and
 * makes byte-exact tests non-deterministic. */
static size_t finish_chunk(uint8_t *out, size_t total) {
  size_t padded = scr_sctp_pad4(total);
  for (size_t i = total; i < padded; i++) out[i] = 0;
  return padded;
}

/* No optional parameters, and that is a STATEMENT rather than an
 * omission: not sending Forward-TSN-Supported is how this endpoint tells
 * the peer it does not do PR-SCTP. That is exactly true — the channel is
 * unordered RELIABLE — so advertising the extension and then refusing to
 * honour a FORWARD-TSN would be the bug. A peer that wants partial
 * reliability will not get it, and will not be told otherwise. */
size_t scr_sctp_write_init(uint8_t *out, size_t cap, uint32_t init_tag,
                           uint32_t a_rwnd, uint16_t out_streams,
                           uint16_t in_streams, uint32_t initial_tsn) {
  size_t total = write_chunk_header(out, cap, SCR_SCTP_CHUNK_INIT, 0, 16);
  if (total == 0) return 0;
  uint8_t *v = out + SCR_SCTP_CHUNK_HDR_LEN;
  put_be32(v + 0, init_tag);
  put_be32(v + 4, a_rwnd);
  put_be16(v + 8, out_streams);
  put_be16(v + 10, in_streams);
  put_be32(v + 12, initial_tsn);
  return finish_chunk(out, total);
}

bool scr_sctp_read_init_ack(const uint8_t *value, size_t value_len,
                            ScrSctpInitAck *out) {
  /* INIT ACK's fixed part is the same 16 bytes as INIT; the State
   * Cookie arrives as a variable parameter after it. */
  if (value == NULL || out == NULL || value_len < 16) return false;
  out->init_tag = get_be32(value + 0);
  out->a_rwnd = get_be32(value + 4);
  out->out_streams = get_be16(value + 8);
  out->in_streams = get_be16(value + 10);
  out->initial_tsn = get_be32(value + 12);
  out->cookie = NULL;
  out->cookie_len = 0;

  /* Walk the optional parameters for the State Cookie (type 7). Same
   * bounds discipline as the chunk walk: a parameter shorter than its
   * header, or longer than what remains, ends the walk. */
  size_t off = 16;
  while (off + 4 <= value_len) {
    uint16_t ptype = get_be16(value + off);
    uint16_t plen = get_be16(value + off + 2);
    if (plen < 4) return true; /* malformed; cookie stays absent */
    if (off + (size_t)plen > value_len) return true;
    if (ptype == SCR_SCTP_PARAM_STATE_COOKIE) {
      out->cookie = value + off + 4;
      out->cookie_len = (size_t)plen - 4;
      return true;
    }
    size_t advance = scr_sctp_pad4((size_t)plen);
    if (advance == 0 || off + advance <= off) return true;
    off += advance;
  }
  return true;
}

size_t scr_sctp_write_cookie_echo(uint8_t *out, size_t cap,
                                  const uint8_t *cookie, size_t cookie_len) {
  size_t total =
      write_chunk_header(out, cap, SCR_SCTP_CHUNK_COOKIE_ECHO, 0, cookie_len);
  if (total == 0) return 0;
  if (cookie_len > 0) {
    if (cookie == NULL) return 0;
    memcpy(out + SCR_SCTP_CHUNK_HDR_LEN, cookie, cookie_len);
  }
  return finish_chunk(out, total);
}

size_t scr_sctp_write_data(uint8_t *out, size_t cap, uint32_t tsn,
                           uint16_t stream_id, uint32_t ppid,
                           const uint8_t *payload, size_t payload_len,
                           bool unordered, bool beginning, bool ending) {
  uint8_t flags = 0;
  if (unordered) flags |= SCR_SCTP_DATA_FLAG_U;
  if (beginning) flags |= SCR_SCTP_DATA_FLAG_B;
  if (ending) flags |= SCR_SCTP_DATA_FLAG_E;

  size_t total = write_chunk_header(out, cap, SCR_SCTP_CHUNK_DATA, flags,
                                    12 + payload_len);
  if (total == 0) return 0;
  uint8_t *v = out + SCR_SCTP_CHUNK_HDR_LEN;
  put_be32(v + 0, tsn);
  put_be16(v + 4, stream_id);
  /* Stream sequence number. Unordered DATA ignores it on receive
   * (RFC 4960 s6.6), and this workload is always unordered, so it is
   * sent as 0 rather than tracked per stream. */
  put_be16(v + 6, 0);
  put_be32(v + 8, ppid);
  if (payload_len > 0) {
    if (payload == NULL) return 0;
    memcpy(v + 12, payload, payload_len);
  }
  return finish_chunk(out, total);
}

bool scr_sctp_read_data(const uint8_t *value, size_t value_len,
                        ScrSctpData *out) {
  if (value == NULL || out == NULL || value_len < 12) return false;
  out->tsn = get_be32(value + 0);
  out->stream_id = get_be16(value + 4);
  out->stream_seq = get_be16(value + 6);
  out->ppid = get_be32(value + 8);
  out->payload = value + 12;
  out->payload_len = value_len - 12;
  return true;
}

size_t scr_sctp_write_sack(uint8_t *out, size_t cap, uint32_t cum_tsn_ack,
                           uint32_t a_rwnd) {
  /* No gap-ack blocks and no duplicate TSNs: the cumulative ack alone.
   * Sufficient while the receive path delivers in arrival order and
   * acknowledges the contiguous prefix. Gap blocks are the next thing
   * this grows if a peer's loss pattern needs them. */
  size_t total = write_chunk_header(out, cap, SCR_SCTP_CHUNK_SACK, 0, 12);
  if (total == 0) return 0;
  uint8_t *v = out + SCR_SCTP_CHUNK_HDR_LEN;
  put_be32(v + 0, cum_tsn_ack);
  put_be32(v + 4, a_rwnd);
  put_be16(v + 8, 0);  /* gap ack blocks */
  put_be16(v + 10, 0); /* duplicate TSNs */
  return finish_chunk(out, total);
}

size_t scr_sctp_write_heartbeat_ack(uint8_t *out, size_t cap,
                                    const uint8_t *info, size_t info_len) {
  /* The HEARTBEAT ACK echoes the sender's Heartbeat Info parameter
   * VERBATIM, including its parameter header (RFC 4960 s3.3.6) — the
   * peer may have encoded state in it that only it can read. */
  size_t total = write_chunk_header(out, cap, SCR_SCTP_CHUNK_HEARTBEAT_ACK, 0,
                                    info_len);
  if (total == 0) return 0;
  if (info_len > 0) {
    if (info == NULL) return 0;
    memcpy(out + SCR_SCTP_CHUNK_HDR_LEN, info, info_len);
  }
  return finish_chunk(out, total);
}

size_t scr_sctp_write_cookie_ack(uint8_t *out, size_t cap) {
  size_t total = write_chunk_header(out, cap, SCR_SCTP_CHUNK_COOKIE_ACK, 0, 0);
  if (total == 0) return 0;
  return finish_chunk(out, total);
}

/* ── DCEP, RFC 8832 ──────────────────────────────────────────────────
 *
 * Rides as the payload of a DATA chunk with PPID 50. The open message
 * carries the channel's reliability contract; for this workload it is
 * always 0x80 DATA_CHANNEL_RELIABLE_UNORDERED with a zero reliability
 * parameter, because zapo passes { ordered: false } and neither
 * maxRetransmits nor maxPacketLifeTime. */

size_t scr_sctp_write_dcep_open(uint8_t *out, size_t cap, uint8_t channel_type,
                                uint16_t priority, uint32_t reliability,
                                const char *label, size_t label_len,
                                const char *protocol, size_t protocol_len) {
  size_t total = 12 + label_len + protocol_len;
  if (total > cap) return 0;
  if (label_len > 0xFFFFu || protocol_len > 0xFFFFu) return 0;
  out[0] = SCR_SCTP_DCEP_DATA_CHANNEL_OPEN;
  out[1] = channel_type;
  put_be16(out + 2, priority);
  put_be32(out + 4, reliability);
  put_be16(out + 8, (uint16_t)label_len);
  put_be16(out + 10, (uint16_t)protocol_len);
  if (label_len > 0) {
    if (label == NULL) return 0;
    memcpy(out + 12, label, label_len);
  }
  if (protocol_len > 0) {
    if (protocol == NULL) return 0;
    memcpy(out + 12 + label_len, protocol, protocol_len);
  }
  /* NOT padded: DCEP is the DATA chunk's user payload, and the DATA
   * chunk's own padding covers it. Padding here would add bytes the
   * peer would read as part of the protocol string. */
  return total;
}

bool scr_sctp_is_dcep_ack(const uint8_t *payload, size_t len) {
  return payload != NULL && len >= 1 &&
         payload[0] == SCR_SCTP_DCEP_DATA_CHANNEL_ACK;
}
