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
