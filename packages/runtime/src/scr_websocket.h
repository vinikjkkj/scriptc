/* RFC 6455 WebSocket frame codec — the pure, transport-independent core
 * of the native WebSocket client (scr_websocket.c). Masking, client-frame
 * construction, and incoming-header parsing are deterministic byte
 * operations with no runtime, socket, or crypto dependency, so they unit-
 * test in isolation against the RFC's own vectors (test_websocket.c). The
 * socket plumbing and the handshake (which reuse the net/tls and crypto
 * runtime) layer on top of these in later slices. */
#ifndef SCR_WEBSOCKET_H
#define SCR_WEBSOCKET_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* Frame opcodes (RFC 6455 §5.2). */
#define SCR_WS_OP_CONT 0x0
#define SCR_WS_OP_TEXT 0x1
#define SCR_WS_OP_BINARY 0x2
#define SCR_WS_OP_CLOSE 0x8
#define SCR_WS_OP_PING 0x9
#define SCR_WS_OP_PONG 0xA

/* RFC 6455 §5.3 masking: XOR each payload byte with mask[i & 3], in place.
 * Its own inverse — masking a masked payload with the same key restores
 * it. `mask` is 4 bytes. */
void scr_ws_mask(uint8_t *payload, size_t len, const uint8_t mask[4]);

/* The exact byte length scr_ws_build_client_frame writes for a payload of
 * `len` bytes: the 2/4/10-byte header (7-bit / 16-bit / 64-bit extended
 * length) plus the 4-byte mask plus the payload. */
size_t scr_ws_frame_size(size_t len);

/* Build a CLIENT frame (FIN set, always masked — RFC 6455 §5.1 requires
 * client→server frames be masked) into `out`, which the caller sizes at
 * >= scr_ws_frame_size(len). Returns the total bytes written. `mask_key`
 * is the 4-byte masking key (the caller supplies fresh randomness per
 * frame; the codec does not choose it). */
size_t scr_ws_build_client_frame(uint8_t *out, uint8_t opcode,
                                  const uint8_t *payload, size_t len,
                                  const uint8_t mask_key[4]);

/* One parsed incoming frame header. `payload_offset` is where the payload
 * begins relative to the frame start; `payload_len` is its declared
 * length. When `masked` (a server→client frame never is, but a proxy or
 * loopback might), `mask_key` holds the 4-byte key to unmask the payload
 * with scr_ws_mask. */
typedef struct {
  bool fin;
  uint8_t opcode;
  bool masked;
  uint64_t payload_len;
  size_t payload_offset;
  uint8_t mask_key[4];
} ScrWsHeader;

/* Parse the header of ONE frame from `in` (`in_len` bytes available),
 * filling *out. Returns true when the full header is present (the caller
 * then waits for payload_offset + payload_len bytes before delivering the
 * message); false when `in_len` is too small to hold the complete header
 * yet (the caller reads more and retries). Never reads past `in_len`. */
bool scr_ws_parse_header(const uint8_t *in, size_t in_len, ScrWsHeader *out);

#endif /* SCR_WEBSOCKET_H */
