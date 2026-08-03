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

/* ── opening handshake (RFC 6455 §4) ──────────────────────────────────── */

/* The magic GUID appended to a client key before hashing (RFC 6455 §1.3). */
#define SCR_WS_GUID "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

/* Compute the Sec-WebSocket-Accept for a client's Sec-WebSocket-Key:
 * base64(SHA-1(key ++ GUID)). Writes 28 base64 chars + NUL into `out`
 * (>= 29 bytes). `key`/`key_len` is the client key string as sent (the
 * base64 nonce, not decoded). Self-contained (its own SHA-1/base64 —
 * see the .c note) so the transport module needs no crypto link. */
void scr_ws_accept_key(const char *key, size_t key_len, char out[29]);

/* Fill `out` (16 bytes) with the raw Sec-WebSocket-Key nonce from `seed`
 * bytes (the caller supplies randomness — the codec does not choose it),
 * then base64-encode into `b64` (>= 25 bytes: 24 chars + NUL). The two
 * halves are the request's Sec-WebSocket-Key value and the input to
 * scr_ws_accept_key for validating the server's reply. */
void scr_ws_key_b64(const uint8_t seed[16], char b64[25]);

/* Build the client's HTTP Upgrade request (RFC 6455 §4.1) into `out`
 * (capacity `cap`). `host` is the Host header value (host, or host:port
 * when non-default), `path` the request target (at least "/"), `key_b64`
 * the Sec-WebSocket-Key. `protocols` (nullable) becomes the
 * Sec-WebSocket-Protocol value verbatim. Returns the request length, or 0
 * if it would not fit in `cap`. */
size_t scr_ws_build_request(char *out, size_t cap, const char *host,
                            const char *path, const char *key_b64,
                            const char *protocols);

/* Handshake-response outcomes (scr_ws_check_handshake). */
#define SCR_WS_HS_OK 0
#define SCR_WS_HS_INCOMPLETE 1 /* header terminator not received yet */
#define SCR_WS_HS_BAD_STATUS 2 /* status line is not "HTTP/1.1 101" */
#define SCR_WS_HS_BAD_UPGRADE 3 /* Upgrade/Connection headers wrong/absent */
#define SCR_WS_HS_BAD_ACCEPT 4 /* Sec-WebSocket-Accept missing or mismatched */

/* Validate a server's handshake response (RFC 6455 §4.1). `resp`/`len` is
 * the received bytes. `expected_accept` is scr_ws_accept_key's output for
 * the key that was sent. On SCR_WS_HS_OK, *header_len is set to the byte
 * offset just past the "\r\n\r\n" (where any buffered frame data begins).
 * Returns SCR_WS_HS_INCOMPLETE when the header terminator is not present
 * yet (the caller reads more and retries); otherwise a specific failure.
 * Header-name matching is case-insensitive (RFC 7230); Upgrade must name
 * "websocket" and Connection must name "upgrade" (token search, so a
 * multi-valued Connection header is accepted). */
int scr_ws_check_handshake(const uint8_t *resp, size_t len,
                           const char *expected_accept, size_t *header_len);

#endif /* SCR_WEBSOCKET_H */
