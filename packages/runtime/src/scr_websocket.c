/* RFC 6455 WebSocket frame codec (see scr_websocket.h for the contract).
 *
 * This slice is the pure byte layer — masking, client-frame construction,
 * incoming-header parsing — with no runtime/socket/crypto dependency, so
 * it is exhaustively testable against the RFC's own vectors offline. The
 * transport (a scr_net/scr_tls socket's native reader) and the opening
 * handshake (SHA-1 + base64 over the Sec-WebSocket-Key, reusing the
 * crypto runtime) build on these functions in later slices. */
#include "scr_websocket.h"

#include <stdlib.h>
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

/* ── HTTP Upgrade request / response (RFC 6455 §4.1) ───────────────────── */

/* Append `s` to out[*p] within `cap`, returning false on overflow. */
static bool scr_ws_append(char *out, size_t cap, size_t *p, const char *s) {
  size_t n = strlen(s);
  if (*p + n > cap) return false;
  memcpy(out + *p, s, n);
  *p += n;
  return true;
}

size_t scr_ws_build_request(char *out, size_t cap, const char *host,
                            const char *path, const char *key_b64,
                            const char *protocols, const char *extra) {
  size_t p = 0;
  bool ok = scr_ws_append(out, cap, &p, "GET ") &&
            scr_ws_append(out, cap, &p, path) &&
            scr_ws_append(out, cap, &p, " HTTP/1.1\r\nHost: ") &&
            scr_ws_append(out, cap, &p, host) &&
            scr_ws_append(out, cap, &p,
                          "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                          "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ") &&
            scr_ws_append(out, cap, &p, key_b64) &&
            scr_ws_append(out, cap, &p, "\r\n");
  if (ok && protocols != NULL && protocols[0] != '\0') {
    ok = scr_ws_append(out, cap, &p, "Sec-WebSocket-Protocol: ") &&
         scr_ws_append(out, cap, &p, protocols) &&
         scr_ws_append(out, cap, &p, "\r\n");
  }
  /* The caller's own header lines, verbatim and already terminated. */
  if (ok && extra != NULL && extra[0] != '\0') {
    ok = scr_ws_append(out, cap, &p, extra);
  }
  if (ok) ok = scr_ws_append(out, cap, &p, "\r\n");
  if (!ok) return 0;
  return p;
}

/* ASCII lowercase. */
static char scr_ws_lc(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c; }

/* Case-insensitive compare of `n` bytes of `a` against the NUL-terminated
 * lowercase literal `lit` (which must be `n` chars). */
static bool scr_ws_ci_eq(const char *a, const char *lit, size_t n) {
  for (size_t i = 0; i < n; i++)
    if (scr_ws_lc(a[i]) != lit[i]) return false;
  return true;
}

/* True when the header VALUE [v, v+vlen) contains `token` as a
 * comma/space-delimited, case-insensitive token (Connection: keep-alive,
 * Upgrade). */
static bool scr_ws_value_has_token(const char *v, size_t vlen, const char *token) {
  size_t tlen = strlen(token);
  size_t i = 0;
  while (i < vlen) {
    while (i < vlen && (v[i] == ' ' || v[i] == ',' || v[i] == '\t')) i++;
    size_t start = i;
    while (i < vlen && v[i] != ',' ) i++;
    size_t end = i;
    while (end > start && (v[end - 1] == ' ' || v[end - 1] == '\t')) end--;
    if (end - start == tlen && scr_ws_ci_eq(v + start, token, tlen)) return true;
  }
  return false;
}

int scr_ws_check_handshake(const uint8_t *resp, size_t len,
                           const char *expected_accept, size_t *header_len) {
  const char *s = (const char *)resp;
  /* Find the header terminator "\r\n\r\n". */
  size_t end = 0;
  bool found = false;
  for (size_t i = 0; i + 3 < len; i++) {
    if (s[i] == '\r' && s[i + 1] == '\n' && s[i + 2] == '\r' && s[i + 3] == '\n') {
      end = i + 4;
      found = true;
      break;
    }
  }
  if (!found) return SCR_WS_HS_INCOMPLETE;
  *header_len = end;

  /* Status line: "HTTP/1.1 101" (any reason phrase). */
  {
    size_t i = 0;
    while (i < end && s[i] != ' ') i++; /* past "HTTP/1.1" */
    while (i < end && s[i] == ' ') i++;
    if (i + 3 > end || s[i] != '1' || s[i + 1] != '0' || s[i + 2] != '1') {
      return SCR_WS_HS_BAD_STATUS;
    }
  }

  /* Walk the header lines, matching Upgrade / Connection / Accept. */
  bool up_ok = false, conn_ok = false, accept_seen = false, accept_ok = false;
  size_t i = 0;
  /* skip the status line */
  while (i < end && !(s[i] == '\r' && s[i + 1] == '\n')) i++;
  i += 2;
  while (i < end) {
    if (s[i] == '\r' && i + 1 < end && s[i + 1] == '\n') break; /* end of headers */
    size_t ls = i;
    while (i < end && s[i] != '\r') i++;
    size_t le = i; /* [ls, le) is one header line */
    i += 2;        /* past CRLF */
    /* Split at the first ':'. */
    size_t colon = ls;
    while (colon < le && s[colon] != ':') colon++;
    if (colon >= le) continue;
    size_t nlen = colon - ls;
    size_t vs = colon + 1;
    while (vs < le && (s[vs] == ' ' || s[vs] == '\t')) vs++;
    size_t vlen = le - vs;
    if (nlen == 7 && scr_ws_ci_eq(s + ls, "upgrade", 7)) {
      up_ok = scr_ws_value_has_token(s + vs, vlen, "websocket");
    } else if (nlen == 10 && scr_ws_ci_eq(s + ls, "connection", 10)) {
      conn_ok = scr_ws_value_has_token(s + vs, vlen, "upgrade");
    } else if (nlen == 20 && scr_ws_ci_eq(s + ls, "sec-websocket-accept", 20)) {
      accept_seen = true;
      size_t elen = strlen(expected_accept);
      accept_ok = vlen == elen && memcmp(s + vs, expected_accept, elen) == 0;
    }
  }
  if (!up_ok || !conn_ok) return SCR_WS_HS_BAD_UPGRADE;
  if (!accept_seen || !accept_ok) return SCR_WS_HS_BAD_ACCEPT;
  return SCR_WS_HS_OK;
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

/* ── connection state machine (see scr_websocket.h) ────────────────────── */

enum { SCR_WS_ST_HANDSHAKE, SCR_WS_ST_OPEN, SCR_WS_ST_CLOSING, SCR_WS_ST_CLOSED };

struct ScrWsConn {
  int state;
  ScrWsCallbacks cb;
  void *user;
  char accept[29];
  uint32_t mask_state; /* rotated per frame for masking keys */

  uint8_t *buf; /* reassembly buffer of received-but-unconsumed bytes */
  size_t buf_len, buf_cap;

  /* Fragmented-message accumulation (opcode of the first fragment). */
  uint8_t *msg; /* payload accumulated across CONT frames */
  size_t msg_len, msg_cap;
  uint8_t msg_opcode; /* 0x1 or 0x2; 0 = no fragment in progress */
};

static bool scr_ws_buf_reserve(uint8_t **b, size_t *cap, size_t need) {
  if (need <= *cap) return true;
  size_t nc = *cap ? *cap : 256;
  while (nc < need) nc *= 2;
  uint8_t *nb = (uint8_t *)realloc(*b, nc);
  if (!nb) return false;
  *b = nb;
  *cap = nc;
  return true;
}

/* A small deterministic PRNG for masking keys. Masking is anti-proxy-cache
 * hygiene, not security (RFC 6455 §10.3), so a rotated xorshift over the
 * caller's seed suffices and keeps the module free of a crypto-RNG dep. */
static void scr_ws_next_mask(ScrWsConn *c, uint8_t out[4]) {
  uint32_t x = c->mask_state;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  c->mask_state = x;
  out[0] = (uint8_t)(x); out[1] = (uint8_t)(x >> 8);
  out[2] = (uint8_t)(x >> 16); out[3] = (uint8_t)(x >> 24);
}

ScrWsConn *scr_ws_conn_new(const char *expected_accept,
                           const ScrWsCallbacks *cb, void *user,
                           const uint8_t mask_seed[4]) {
  ScrWsConn *c = (ScrWsConn *)calloc(1, sizeof *c);
  if (!c) return NULL;
  c->state = SCR_WS_ST_HANDSHAKE;
  c->cb = *cb;
  c->user = user;
  size_t n = strlen(expected_accept);
  if (n > 28) n = 28;
  memcpy(c->accept, expected_accept, n);
  c->accept[n] = '\0';
  c->mask_state = ((uint32_t)mask_seed[0]) | ((uint32_t)mask_seed[1] << 8) |
                  ((uint32_t)mask_seed[2] << 16) | ((uint32_t)mask_seed[3] << 24);
  if (c->mask_state == 0) c->mask_state = 0x9e3779b9u; /* xorshift must not start at 0 */
  return c;
}

void scr_ws_conn_free(ScrWsConn *c) {
  if (!c) return;
  free(c->buf);
  free(c->msg);
  free(c);
}

static void scr_ws_emit_error(ScrWsConn *c, const char *msg) {
  c->state = SCR_WS_ST_CLOSED;
  if (c->cb.on_error) c->cb.on_error(c->user, msg);
}

/* Send a control or data frame with a fresh mask. */
static void scr_ws_write_frame(ScrWsConn *c, uint8_t opcode,
                               const uint8_t *payload, size_t len) {
  uint8_t mask[4];
  scr_ws_next_mask(c, mask);
  size_t need = scr_ws_frame_size(len);
  uint8_t *frame = (uint8_t *)malloc(need);
  if (!frame) return;
  size_t n = scr_ws_build_client_frame(frame, opcode, payload, len, mask);
  if (c->cb.want_write) c->cb.want_write(c->user, frame, n);
  free(frame);
}

void scr_ws_conn_send(ScrWsConn *c, const uint8_t *data, size_t len, bool is_text) {
  if (c->state != SCR_WS_ST_OPEN) return;
  scr_ws_write_frame(c, is_text ? SCR_WS_OP_TEXT : SCR_WS_OP_BINARY, data, len);
}

void scr_ws_conn_close(ScrWsConn *c, uint16_t code, const uint8_t *reason, size_t reason_len) {
  if (c->state == SCR_WS_ST_CLOSING || c->state == SCR_WS_ST_CLOSED) return;
  uint8_t body[125];
  size_t n = 0;
  if (code != 0) {
    body[n++] = (uint8_t)(code >> 8);
    body[n++] = (uint8_t)(code & 0xff);
    if (reason && reason_len > 0) {
      size_t rn = reason_len > 123 ? 123 : reason_len;
      memcpy(body + n, reason, rn);
      n += rn;
    }
  }
  scr_ws_write_frame(c, SCR_WS_OP_CLOSE, body, n);
  c->state = SCR_WS_ST_CLOSING;
}

void scr_ws_conn_eof(ScrWsConn *c) {
  if (c->state == SCR_WS_ST_CLOSED) return;
  int was = c->state;
  c->state = SCR_WS_ST_CLOSED;
  if ((was == SCR_WS_ST_OPEN || was == SCR_WS_ST_CLOSING) && c->cb.on_close) {
    /* 1006: abnormal closure, no close frame received. CLOSING counts:
     * a client that sent its Close and then saw the stream end without
     * a reply never completed the closing handshake, so the event is
     * the abnormal one -- Node reports `close 1006 wasClean=false`
     * there (measured against a server that answers a close frame with
     * a reset). Swallowing it lost the ONLY close event such a program
     * ever gets. A completed handshake never reaches here: the peer's
     * close frame already moved the state to CLOSED. */
    c->cb.on_close(c->user, 1006, NULL, 0);
  }
}

/* Process complete frames at the front of the buffer. Returns false on a
 * protocol error (error already emitted). */
static bool scr_ws_drain_frames(ScrWsConn *c) {
  for (;;) {
    if (c->buf_len < 2) return true;
    ScrWsHeader h;
    if (!scr_ws_parse_header(c->buf, c->buf_len, &h)) return true; /* need more */
    if (h.payload_len > (uint64_t)(SIZE_MAX - h.payload_offset)) {
      scr_ws_emit_error(c, "websocket frame length overflow");
      return false;
    }
    size_t total = h.payload_offset + (size_t)h.payload_len;
    if (c->buf_len < total) return true; /* full payload not here yet */

    uint8_t *pay = c->buf + h.payload_offset;
    size_t plen = (size_t)h.payload_len;
    /* Servers never mask (RFC 6455 §5.1), but unmask defensively if set. */
    if (h.masked) scr_ws_mask(pay, plen, h.mask_key);

    if (h.opcode == SCR_WS_OP_CLOSE) {
      uint16_t code = 1005;
      const uint8_t *reason = NULL;
      size_t rlen = 0;
      if (plen >= 2) {
        code = (uint16_t)((pay[0] << 8) | pay[1]);
        reason = pay + 2;
        rlen = plen - 2;
      }
      if (c->state == SCR_WS_ST_OPEN) {
        /* Echo the CODE, never the peer's reason. RFC 6455 §5.5.1 leaves
         * the reply body open, and this used to send `pay`/`plen` back
         * verbatim -- so a server that closed with a reason got its own
         * reason quoted at it, where Node/undici answer with the bare
         * two-byte status code. Measured against node v25.9.0: a server
         * close(1001, "going") is answered with `88 02 03 e9`, not
         * `88 07 03 e9 g o i n g`. A close with no body stays bodiless. */
        uint8_t echo[2];
        size_t elen = 0;
        if (plen >= 2) { echo[0] = pay[0]; echo[1] = pay[1]; elen = 2; }
        scr_ws_write_frame(c, SCR_WS_OP_CLOSE, echo, elen);
      }
      int was = c->state;
      c->state = SCR_WS_ST_CLOSED;
      if (was != SCR_WS_ST_CLOSED && c->cb.on_close) c->cb.on_close(c->user, code, reason, rlen);
      memmove(c->buf, c->buf + total, c->buf_len - total);
      c->buf_len -= total;
      return true; /* nothing after a close matters */
    } else if (h.opcode == SCR_WS_OP_PING) {
      scr_ws_write_frame(c, SCR_WS_OP_PONG, pay, plen);
    } else if (h.opcode == SCR_WS_OP_PONG) {
      /* keepalive acknowledged */
    } else if (h.opcode == SCR_WS_OP_TEXT || h.opcode == SCR_WS_OP_BINARY ||
               h.opcode == SCR_WS_OP_CONT) {
      uint8_t op = h.opcode;
      if (op == SCR_WS_OP_CONT) {
        if (c->msg_opcode == 0) { scr_ws_emit_error(c, "unexpected continuation frame"); return false; }
      } else {
        if (c->msg_opcode != 0) { scr_ws_emit_error(c, "new data frame before completion"); return false; }
        c->msg_opcode = op;
      }
      if (!scr_ws_buf_reserve(&c->msg, &c->msg_cap, c->msg_len + plen)) {
        scr_ws_emit_error(c, "websocket message allocation failed");
        return false;
      }
      memcpy(c->msg + c->msg_len, pay, plen);
      c->msg_len += plen;
      if (h.fin) {
        bool is_text = c->msg_opcode == SCR_WS_OP_TEXT;
        if (c->cb.on_message) c->cb.on_message(c->user, c->msg, c->msg_len, is_text);
        c->msg_len = 0;
        c->msg_opcode = 0;
      }
    } else {
      scr_ws_emit_error(c, "unsupported websocket opcode");
      return false;
    }

    memmove(c->buf, c->buf + total, c->buf_len - total);
    c->buf_len -= total;
  }
}

bool scr_ws_conn_recv(ScrWsConn *c, const uint8_t *data, size_t len) {
  if (c->state == SCR_WS_ST_CLOSED) return true;
  if (!scr_ws_buf_reserve(&c->buf, &c->buf_cap, c->buf_len + len)) {
    scr_ws_emit_error(c, "websocket receive buffer allocation failed");
    return false;
  }
  memcpy(c->buf + c->buf_len, data, len);
  c->buf_len += len;

  if (c->state == SCR_WS_ST_HANDSHAKE) {
    size_t header_len = 0;
    int r = scr_ws_check_handshake(c->buf, c->buf_len, c->accept, &header_len);
    if (r == SCR_WS_HS_INCOMPLETE) return true;
    if (r != SCR_WS_HS_OK) {
      scr_ws_emit_error(c, r == SCR_WS_HS_BAD_STATUS ? "websocket handshake: unexpected status"
                        : r == SCR_WS_HS_BAD_UPGRADE ? "websocket handshake: bad Upgrade/Connection"
                        : "websocket handshake: invalid Sec-WebSocket-Accept");
      return false;
    }
    memmove(c->buf, c->buf + header_len, c->buf_len - header_len);
    c->buf_len -= header_len;
    c->state = SCR_WS_ST_OPEN;
    if (c->cb.on_open) c->cb.on_open(c->user);
  }

  return scr_ws_drain_frames(c);
}
