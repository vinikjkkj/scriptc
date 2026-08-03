/* RFC 6455 WebSocket frame codec (see scr_websocket.h for the contract).
 *
 * This slice is the pure byte layer — masking, client-frame construction,
 * incoming-header parsing — with no runtime/socket/crypto dependency, so
 * it is exhaustively testable against the RFC's own vectors offline. The
 * transport (a scr_net/scr_tls socket's native reader) and the opening
 * handshake (SHA-1 + base64 over the Sec-WebSocket-Key, reusing the
 * crypto runtime) build on these functions in later slices. */
#include "scr_websocket.h"

#include <string.h>

void scr_ws_mask(uint8_t *payload, size_t len, const uint8_t mask[4]) {
  for (size_t i = 0; i < len; i++) payload[i] ^= mask[i & 3];
}

size_t scr_ws_frame_size(size_t len) {
  size_t header = 2;
  if (len > 65535) header += 8;
  else if (len >= 126) header += 2;
  return header + 4 /* mask */ + len;
}

size_t scr_ws_build_client_frame(uint8_t *out, uint8_t opcode,
                                  const uint8_t *payload, size_t len,
                                  const uint8_t mask_key[4]) {
  size_t p = 0;
  out[p++] = (uint8_t)(0x80 | (opcode & 0x0f)); /* FIN + opcode */
  /* MASK bit always set (client frames), then the length encoding. */
  if (len > 65535) {
    out[p++] = 0x80 | 127;
    for (int i = 7; i >= 0; i--) out[p++] = (uint8_t)((uint64_t)len >> (i * 8));
  } else if (len >= 126) {
    out[p++] = 0x80 | 126;
    out[p++] = (uint8_t)(len >> 8);
    out[p++] = (uint8_t)(len & 0xff);
  } else {
    out[p++] = (uint8_t)(0x80 | len);
  }
  memcpy(out + p, mask_key, 4);
  p += 4;
  if (len > 0) memcpy(out + p, payload, len);
  scr_ws_mask(out + p, len, mask_key);
  return p + len;
}

/* ── handshake primitives ─────────────────────────────────────────────
 * The opening handshake needs SHA-1 and base64. The user-facing crypto
 * surface has its own (scr_lib.c), but coupling the transport module to
 * that heavy translation unit would forfeit this module's self-contained,
 * offline-testable shape (the frame codec's whole value). SHA-1 and
 * base64 are small, fixed, and RFC-vector-pinned, so the handshake keeps
 * its own — the standard practice for a self-contained WS client. */

static uint32_t scr_ws_rotl(uint32_t x, int n) { return (x << n) | (x >> (32 - n)); }

/* One SHA-1 compression over a 64-byte block into the running state. */
static void scr_ws_sha1_block(uint32_t h[5], const uint8_t block[64]) {
  uint32_t w[80];
  for (int i = 0; i < 16; i++)
    w[i] = ((uint32_t)block[i * 4] << 24) | ((uint32_t)block[i * 4 + 1] << 16) |
           ((uint32_t)block[i * 4 + 2] << 8) | block[i * 4 + 3];
  for (int i = 16; i < 80; i++)
    w[i] = scr_ws_rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
  uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
  for (int i = 0; i < 80; i++) {
    uint32_t f, k;
    if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999u; }
    else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1u; }
    else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDCu; }
    else { f = b ^ c ^ d; k = 0xCA62C1D6u; }
    uint32_t tmp = scr_ws_rotl(a, 5) + f + e + k + w[i];
    e = d; d = c; c = scr_ws_rotl(b, 30); b = a; a = tmp;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
}

static void scr_ws_sha1(const uint8_t *msg, size_t len, uint8_t out[20]) {
  uint32_t h[5] = {0x67452301u, 0xEFCDAB89u, 0x98BADCFEu, 0x10325476u, 0xC3D2E1F0u};
  size_t off = 0;
  for (; off + 64 <= len; off += 64) scr_ws_sha1_block(h, msg + off);
  /* Final block(s): the remaining bytes, 0x80, zero pad to 56 mod 64, then
   * the 64-bit big-endian bit length. One or two blocks. */
  uint8_t tail[128];
  size_t rem = len - off;
  memcpy(tail, msg + off, rem);
  tail[rem] = 0x80;
  size_t padded = rem + 1;
  while (padded % 64 != 56) tail[padded++] = 0;
  uint64_t bits = (uint64_t)len * 8;
  for (int i = 7; i >= 0; i--) tail[padded++] = (uint8_t)(bits >> (i * 8));
  for (size_t b = 0; b < padded; b += 64) scr_ws_sha1_block(h, tail + b);
  for (int i = 0; i < 5; i++) {
    out[i * 4] = (uint8_t)(h[i] >> 24);
    out[i * 4 + 1] = (uint8_t)(h[i] >> 16);
    out[i * 4 + 2] = (uint8_t)(h[i] >> 8);
    out[i * 4 + 3] = (uint8_t)h[i];
  }
}

static const char SCR_WS_B64[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/* Standard padded base64 of `n` bytes into `out` (caller sizes it); no NUL
 * written. Returns the number of chars written (4 * ceil(n/3)). */
static size_t scr_ws_b64_encode(const uint8_t *in, size_t n, char *out) {
  size_t o = 0, i = 0;
  while (i + 3 <= n) {
    uint32_t v = ((uint32_t)in[i] << 16) | ((uint32_t)in[i + 1] << 8) | in[i + 2];
    out[o++] = SCR_WS_B64[(v >> 18) & 63];
    out[o++] = SCR_WS_B64[(v >> 12) & 63];
    out[o++] = SCR_WS_B64[(v >> 6) & 63];
    out[o++] = SCR_WS_B64[v & 63];
    i += 3;
  }
  size_t rem = n - i;
  if (rem == 1) {
    uint32_t v = (uint32_t)in[i] << 16;
    out[o++] = SCR_WS_B64[(v >> 18) & 63];
    out[o++] = SCR_WS_B64[(v >> 12) & 63];
    out[o++] = '=';
    out[o++] = '=';
  } else if (rem == 2) {
    uint32_t v = ((uint32_t)in[i] << 16) | ((uint32_t)in[i + 1] << 8);
    out[o++] = SCR_WS_B64[(v >> 18) & 63];
    out[o++] = SCR_WS_B64[(v >> 12) & 63];
    out[o++] = SCR_WS_B64[(v >> 6) & 63];
    out[o++] = '=';
  }
  return o;
}

void scr_ws_accept_key(const char *key, size_t key_len, char out[29]) {
  /* Sec-WebSocket-Key is a base64-encoded 16-byte nonce — 24 chars in
   * practice. The staging buffer is sized well past that (any realistic
   * header value fits); the cap is a hard bound against a malformed
   * oversized value, never reached by a conforming peer. */
  uint8_t concat[220 + 36];
  size_t glen = sizeof(SCR_WS_GUID) - 1;
  size_t n = key_len;
  if (n > 220) n = 220;
  memcpy(concat, key, n);
  memcpy(concat + n, SCR_WS_GUID, glen);
  uint8_t digest[20];
  scr_ws_sha1(concat, n + glen, digest);
  size_t w = scr_ws_b64_encode(digest, 20, out);
  out[w] = '\0';
}

void scr_ws_key_b64(const uint8_t seed[16], char b64[25]) {
  size_t w = scr_ws_b64_encode(seed, 16, b64);
  b64[w] = '\0';
}

bool scr_ws_parse_header(const uint8_t *in, size_t in_len, ScrWsHeader *out) {
  if (in_len < 2) return false;
  out->fin = (in[0] & 0x80) != 0;
  out->opcode = in[0] & 0x0f;
  out->masked = (in[1] & 0x80) != 0;
  uint8_t len7 = in[1] & 0x7f;
  size_t p = 2;
  if (len7 == 126) {
    if (in_len < p + 2) return false;
    out->payload_len = ((uint64_t)in[p] << 8) | in[p + 1];
    p += 2;
  } else if (len7 == 127) {
    if (in_len < p + 8) return false;
    uint64_t v = 0;
    for (int i = 0; i < 8; i++) v = (v << 8) | in[p + i];
    out->payload_len = v;
    p += 8;
  } else {
    out->payload_len = len7;
  }
  if (out->masked) {
    if (in_len < p + 4) return false;
    memcpy(out->mask_key, in + p, 4);
    p += 4;
  } else {
    memset(out->mask_key, 0, 4);
  }
  out->payload_offset = p;
  return true;
}
