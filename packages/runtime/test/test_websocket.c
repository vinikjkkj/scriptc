/* Offline unit tests for the RFC 6455 frame codec (scr_websocket.c),
 * pinned against the RFC's own worked examples (§5.7) plus round-trip and
 * boundary checks. Prints "<pass>/<total> cases passed" to stderr, exit 0
 * iff all passed — the runtime test-harness contract (see number.test.ts). */
#include "../src/scr_websocket.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int total = 0, passed = 0;

static void check(int cond, const char *what) {
  total++;
  if (cond) passed++;
  else fprintf(stdout, "FAIL: %s\n", what);
}

/* ── connection state-machine harness ─────────────────────────────────── */

typedef struct {
  int opens, closes, errors;
  uint16_t close_code;
  char last_msg[4096];
  size_t last_msg_len;
  int last_is_text;
  int msg_count;
  uint8_t out[65536];
  size_t out_len;
} Cap;

static void h_open(void *u) { ((Cap *)u)->opens++; }
static void h_msg(void *u, const uint8_t *d, size_t n, bool text) {
  Cap *c = (Cap *)u;
  c->msg_count++;
  c->last_msg_len = n < sizeof c->last_msg ? n : sizeof c->last_msg;
  memcpy(c->last_msg, d, c->last_msg_len);
  c->last_is_text = text;
}
static void h_close(void *u, uint16_t code, const uint8_t *r, size_t rn) {
  Cap *c = (Cap *)u; c->closes++; c->close_code = code; (void)r; (void)rn;
}
static void h_err(void *u, const char *m) { ((Cap *)u)->errors++; (void)m; }
static void h_write(void *u, const uint8_t *d, size_t n) {
  Cap *c = (Cap *)u;
  if (c->out_len + n <= sizeof c->out) { memcpy(c->out + c->out_len, d, n); c->out_len += n; }
}

static ScrWsConn *sm_mk(Cap *cap, const char *accept, const uint8_t seed[4]) {
  ScrWsCallbacks cb = { h_open, h_msg, h_close, h_err, h_write };
  return scr_ws_conn_new(accept, &cb, cap, seed);
}

/* Build an unmasked server frame (server->client is never masked). */
static size_t sm_server_frame(uint8_t *out, uint8_t opcode, const uint8_t *pay, size_t len) {
  size_t p = 0;
  out[p++] = (uint8_t)(0x80 | opcode);
  if (len > 65535) { out[p++] = 127; for (int i = 7; i >= 0; i--) out[p++] = (uint8_t)((uint64_t)len >> (i * 8)); }
  else if (len >= 126) { out[p++] = 126; out[p++] = (uint8_t)(len >> 8); out[p++] = (uint8_t)(len & 0xff); }
  else out[p++] = (uint8_t)len;
  if (len) memcpy(out + p, pay, len);
  return p + len;
}

/* Drive the whole connection lifecycle purely by feeding bytes. */
static void run_state_machine_tests(void) {
  const uint8_t seed[4] = {0x12, 0x34, 0x56, 0x78};
  const char *key = "dGhlIHNhbXBsZSBub25jZQ==";
  char accept[29];
  scr_ws_accept_key(key, strlen(key), accept);
  const char *hs =
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
      "Connection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n";

  /* Handshake fed one byte at a time, then a text message split mid-header. */
  {
    Cap cap; memset(&cap, 0, sizeof cap);
    ScrWsConn *c = sm_mk(&cap, accept, seed);
    for (size_t i = 0; i < strlen(hs); i++) scr_ws_conn_recv(c, (const uint8_t *)hs + i, 1);
    check(cap.opens == 1, "sm: on_open after full handshake");
    check(cap.errors == 0, "sm: no error on valid handshake");
    uint8_t frame[64];
    size_t fn = sm_server_frame(frame, SCR_WS_OP_TEXT, (const uint8_t *)"hello world", 11);
    scr_ws_conn_recv(c, frame, 3);
    scr_ws_conn_recv(c, frame + 3, fn - 3);
    check(cap.msg_count == 1 && cap.last_is_text && cap.last_msg_len == 11 &&
          memcmp(cap.last_msg, "hello world", 11) == 0, "sm: split text message");
    scr_ws_conn_free(c);
  }

  /* Fragmented binary: FIN=0 binary + FIN=1 continuation. */
  {
    Cap cap; memset(&cap, 0, sizeof cap);
    ScrWsConn *c = sm_mk(&cap, accept, seed);
    scr_ws_conn_recv(c, (const uint8_t *)hs, strlen(hs));
    uint8_t f1[4] = {0x02, 2, 'A', 'B'}, f2[4] = {0x80, 2, 'C', 'D'};
    scr_ws_conn_recv(c, f1, 4);
    check(cap.msg_count == 0, "sm: no message until FIN");
    scr_ws_conn_recv(c, f2, 4);
    check(cap.msg_count == 1 && !cap.last_is_text && cap.last_msg_len == 4 &&
          memcmp(cap.last_msg, "ABCD", 4) == 0, "sm: reassembled fragmented binary");
    scr_ws_conn_free(c);
  }

  /* Ping -> auto-pong echoing the payload. */
  {
    Cap cap; memset(&cap, 0, sizeof cap);
    ScrWsConn *c = sm_mk(&cap, accept, seed);
    scr_ws_conn_recv(c, (const uint8_t *)hs, strlen(hs));
    cap.out_len = 0;
    uint8_t ping[16];
    size_t pn = sm_server_frame(ping, SCR_WS_OP_PING, (const uint8_t *)"pp", 2);
    scr_ws_conn_recv(c, ping, pn);
    ScrWsHeader ph;
    check(cap.out_len > 0 && scr_ws_parse_header(cap.out, cap.out_len, &ph) &&
          ph.opcode == SCR_WS_OP_PONG && ph.masked && ph.payload_len == 2, "sm: masked PONG written");
    uint8_t pbody[2]; memcpy(pbody, cap.out + ph.payload_offset, 2);
    scr_ws_mask(pbody, 2, ph.mask_key);
    check(memcmp(pbody, "pp", 2) == 0, "sm: pong echoes ping payload");
    scr_ws_conn_free(c);
  }

  /* send() gated on OPEN; after OPEN it writes a masked frame. */
  {
    Cap cap; memset(&cap, 0, sizeof cap);
    ScrWsConn *c = sm_mk(&cap, accept, seed);
    scr_ws_conn_send(c, (const uint8_t *)"x", 1, true);
    check(cap.out_len == 0, "sm: send before open is a no-op");
    scr_ws_conn_recv(c, (const uint8_t *)hs, strlen(hs));
    cap.out_len = 0;
    scr_ws_conn_send(c, (const uint8_t *)"payload!", 8, true);
    ScrWsHeader h;
    check(scr_ws_parse_header(cap.out, cap.out_len, &h) && h.opcode == SCR_WS_OP_TEXT &&
          h.masked && h.payload_len == 8, "sm: sent masked TEXT frame");
    uint8_t body[8]; memcpy(body, cap.out + h.payload_offset, 8);
    scr_ws_mask(body, 8, h.mask_key);
    check(memcmp(body, "payload!", 8) == 0, "sm: sent payload round-trips");
    scr_ws_conn_free(c);
  }

  /* Server close frame -> on_close(code) and a close echo. */
  {
    Cap cap; memset(&cap, 0, sizeof cap);
    ScrWsConn *c = sm_mk(&cap, accept, seed);
    scr_ws_conn_recv(c, (const uint8_t *)hs, strlen(hs));
    cap.out_len = 0;
    uint8_t body[2] = {0x03, 0xe8}; /* 1000 */
    uint8_t cf[16]; size_t cn = sm_server_frame(cf, SCR_WS_OP_CLOSE, body, 2);
    scr_ws_conn_recv(c, cf, cn);
    ScrWsHeader h;
    check(cap.closes == 1 && cap.close_code == 1000, "sm: on_close code 1000");
    check(scr_ws_parse_header(cap.out, cap.out_len, &h) && h.opcode == SCR_WS_OP_CLOSE,
          "sm: close echo written");
    scr_ws_conn_free(c);
  }

  /* A server close WITH A REASON: the echo carries the code and NOTHING
   * else. Node/undici answer close(1001, "going") with the bare status
   * code; quoting the reason back is what this pins against. */
  {
    Cap cap; memset(&cap, 0, sizeof cap);
    ScrWsConn *c = sm_mk(&cap, accept, seed);
    scr_ws_conn_recv(c, (const uint8_t *)hs, strlen(hs));
    cap.out_len = 0;
    uint8_t body[7] = {0x03, 0xe9, 'g', 'o', 'i', 'n', 'g'}; /* 1001 "going" */
    uint8_t cf[24]; size_t cn = sm_server_frame(cf, SCR_WS_OP_CLOSE, body, 7);
    scr_ws_conn_recv(c, cf, cn);
    ScrWsHeader h;
    check(cap.closes == 1 && cap.close_code == 1001, "sm: on_close code 1001");
    check(scr_ws_parse_header(cap.out, cap.out_len, &h) && h.opcode == SCR_WS_OP_CLOSE &&
              h.payload_len == 2,
          "sm: close echo is code-only");
    uint8_t ebody[2];
    memcpy(ebody, cap.out + h.payload_offset, 2);
    scr_ws_mask(ebody, 2, h.mask_key);
    check(ebody[0] == 0x03 && ebody[1] == 0xe9, "sm: close echo carries the peer's code");
    scr_ws_conn_free(c);
  }

  /* Bad Sec-WebSocket-Accept -> on_error, no open. */
  {
    Cap cap; memset(&cap, 0, sizeof cap);
    ScrWsConn *c = sm_mk(&cap, "WRONGACCEPTVALUEHEREXXXXXXXX=", seed);
    scr_ws_conn_recv(c, (const uint8_t *)hs, strlen(hs));
    check(cap.errors == 1 && cap.opens == 0, "sm: bad accept -> on_error");
    scr_ws_conn_free(c);
  }

  /* EOF before a close frame -> 1006. */
  {
    Cap cap; memset(&cap, 0, sizeof cap);
    ScrWsConn *c = sm_mk(&cap, accept, seed);
    scr_ws_conn_recv(c, (const uint8_t *)hs, strlen(hs));
    scr_ws_conn_eof(c);
    check(cap.closes == 1 && cap.close_code == 1006, "sm: EOF -> on_close 1006");
    scr_ws_conn_free(c);
  }

  /* A 1000-byte (16-bit length) message reassembled from 64-byte chunks. */
  {
    Cap cap; memset(&cap, 0, sizeof cap);
    ScrWsConn *c = sm_mk(&cap, accept, seed);
    scr_ws_conn_recv(c, (const uint8_t *)hs, strlen(hs));
    static uint8_t big[1000];
    for (int i = 0; i < 1000; i++) big[i] = (uint8_t)(i * 3 + 7);
    static uint8_t frame[1100];
    size_t fn = sm_server_frame(frame, SCR_WS_OP_BINARY, big, 1000);
    for (size_t i = 0; i < fn; i += 64) {
      size_t chunk = fn - i < 64 ? fn - i : 64;
      scr_ws_conn_recv(c, frame + i, chunk);
    }
    check(cap.msg_count == 1 && cap.last_msg_len == 1000 &&
          memcmp(cap.last_msg, big, 1000) == 0, "sm: 1000-byte binary reassembled");
    scr_ws_conn_free(c);
  }
}

int main(void) {
  /* RFC 6455 §5.7: a single unmasked frame containing "Hello". */
  {
    const uint8_t expect[] = {0x81, 0x05, 'H', 'e', 'l', 'l', 'o'};
    ScrWsHeader h;
    check(scr_ws_parse_header(expect, sizeof expect, &h), "parse unmasked hello header");
    check(h.fin && h.opcode == SCR_WS_OP_TEXT && !h.masked, "unmasked hello fields");
    check(h.payload_len == 5 && h.payload_offset == 2, "unmasked hello len/offset");
    check(memcmp(expect + h.payload_offset, "Hello", 5) == 0, "unmasked hello payload");
  }

  /* RFC 6455 §5.7: a single masked frame containing "Hello", mask key
   * 0x37 0xfa 0x21 0x3d — the exact bytes the RFC lists. */
  {
    const uint8_t mask[4] = {0x37, 0xfa, 0x21, 0x3d};
    const uint8_t expect[] = {0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d,
                              0x7f, 0x9f, 0x4d, 0x51, 0x58};
    uint8_t buf[64];
    size_t n = scr_ws_build_client_frame(buf, SCR_WS_OP_TEXT,
                                         (const uint8_t *)"Hello", 5, mask);
    check(n == sizeof expect, "masked hello frame size");
    check(memcmp(buf, expect, sizeof expect) == 0, "masked hello frame bytes");
    /* Parse it back and unmask. */
    ScrWsHeader h;
    check(scr_ws_parse_header(buf, n, &h), "parse masked hello header");
    check(h.masked && h.payload_len == 5, "masked hello fields");
    uint8_t pay[5];
    memcpy(pay, buf + h.payload_offset, 5);
    scr_ws_mask(pay, 5, h.mask_key);
    check(memcmp(pay, "Hello", 5) == 0, "masked hello round-trip payload");
  }

  /* Masking is its own inverse. */
  {
    const uint8_t mask[4] = {0x01, 0x02, 0x03, 0x04};
    uint8_t data[37];
    for (int i = 0; i < 37; i++) data[i] = (uint8_t)(i * 7 + 1);
    uint8_t orig[37];
    memcpy(orig, data, 37);
    scr_ws_mask(data, 37, mask);
    check(memcmp(data, orig, 37) != 0, "mask changes bytes");
    scr_ws_mask(data, 37, mask);
    check(memcmp(data, orig, 37) == 0, "mask is its own inverse");
  }

  /* Length-encoding boundaries: 125 (7-bit), 126 (16-bit), 65535
   * (16-bit max), 65536 (64-bit). Build then parse, checking the declared
   * length and header size round-trip. */
  {
    const size_t lens[] = {0, 1, 125, 126, 127, 65535, 65536, 200000};
    const uint8_t mask[4] = {0xaa, 0xbb, 0xcc, 0xdd};
    static uint8_t payload[300000];
    for (size_t i = 0; i < sizeof payload; i++) payload[i] = (uint8_t)(i * 31 + 5);
    for (size_t li = 0; li < sizeof lens / sizeof lens[0]; li++) {
      size_t len = lens[li];
      static uint8_t frame[300064];
      size_t n = scr_ws_build_client_frame(frame, SCR_WS_OP_BINARY, payload, len, mask);
      char label[64];
      snprintf(label, sizeof label, "frame_size len=%zu", len);
      check(n == scr_ws_frame_size(len), label);
      ScrWsHeader h;
      snprintf(label, sizeof label, "parse header len=%zu", len);
      check(scr_ws_parse_header(frame, n, &h), label);
      snprintf(label, sizeof label, "declared len=%zu", len);
      check(h.payload_len == len && h.opcode == SCR_WS_OP_BINARY && h.masked, label);
      /* Unmask and compare to the original payload. */
      static uint8_t got[300000];
      memcpy(got, frame + h.payload_offset, len);
      scr_ws_mask(got, len, h.mask_key);
      snprintf(label, sizeof label, "payload round-trip len=%zu", len);
      check(len == 0 || memcmp(got, payload, len) == 0, label);
    }
  }

  /* Partial header: a truncated 16-bit-length frame must report "not yet"
   * rather than reading past the buffer. */
  {
    const uint8_t partial[] = {0x82, 126, 0x01}; /* needs 2 length bytes */
    ScrWsHeader h;
    check(!scr_ws_parse_header(partial, sizeof partial, &h), "partial header waits");
    const uint8_t one[] = {0x82};
    check(!scr_ws_parse_header(one, 1, &h), "single byte waits");
  }

  /* RFC 6455 §1.3 worked handshake example: the client key
   * "dGhlIHNhbXBsZSBub25jZQ==" yields Sec-WebSocket-Accept
   * "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=". */
  {
    const char *key = "dGhlIHNhbXBsZSBub25jZQ==";
    char accept[29];
    scr_ws_accept_key(key, strlen(key), accept);
    check(strcmp(accept, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=") == 0, "RFC 6455 accept-key vector");
  }

  /* base64 of the raw 16-byte key nonce (all-zero seed → known string). */
  {
    const uint8_t seed[16] = {0};
    char b64[25];
    scr_ws_key_b64(seed, b64);
    check(strcmp(b64, "AAAAAAAAAAAAAAAAAAAAAA==") == 0, "zero-nonce key base64");
  }
  {
    /* 0x00..0x0f seed. */
    uint8_t seed[16];
    for (int i = 0; i < 16; i++) seed[i] = (uint8_t)i;
    char b64[25];
    scr_ws_key_b64(seed, b64);
    check(strcmp(b64, "AAECAwQFBgcICQoLDA0ODw==") == 0, "sequential-nonce key base64");
  }

  /* HTTP Upgrade request construction. */
  {
    char req[512];
    size_t n = scr_ws_build_request(req, sizeof req, "example.com:443", "/chat",
                                    "dGhlIHNhbXBsZSBub25jZQ==", NULL, NULL);
    const char *expect =
        "GET /chat HTTP/1.1\r\n"
        "Host: example.com:443\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
        "\r\n";
    check(n == strlen(expect) && memcmp(req, expect, n) == 0, "upgrade request bytes");
  }
  {
    char req[512];
    size_t n = scr_ws_build_request(req, sizeof req, "h", "/", "KKKK", "chat,superchat", NULL);
    check(n > 0 && strstr(req, "Sec-WebSocket-Protocol: chat,superchat\r\n") != NULL,
          "upgrade request protocol header");
  }
  {
    /* The init bag's headers: already-formed lines, appended verbatim
       after the handshake's own and before the terminating CRLF. */
    char req[512];
    size_t n = scr_ws_build_request(req, sizeof req, "h", "/", "KKKK", "chat",
                                    "Cookie: sticky_routing=\r\nX-Probe: 1\r\n");
    check(n > 0 &&
              strstr(req, "Sec-WebSocket-Protocol: chat\r\n"
                          "Cookie: sticky_routing=\r\nX-Probe: 1\r\n\r\n") != NULL,
          "upgrade request extra header block");
    check(n >= 4 && memcmp(req + n - 4, "\r\n\r\n", 4) == 0,
          "extra headers keep the terminator");
  }
  {
    char tiny[16];
    check(scr_ws_build_request(tiny, sizeof tiny, "host", "/", "KEY", NULL, NULL) == 0,
          "upgrade request overflow returns 0");
  }
  {
    char tiny[64];
    check(scr_ws_build_request(tiny, sizeof tiny, "host", "/", "KEY", NULL,
                               "X-Very-Long: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\n") == 0,
          "extra headers that overflow return 0");
  }

  /* Response validation. The accept for key "x3JJHMbDL1EzLkh9GBhXDw==" is
   * "HSmrc0sMlYUkAGmm5OPpG2HaGWk=" (RFC 6455 §1.2 example). */
  {
    const char *key = "x3JJHMbDL1EzLkh9GBhXDw==";
    char accept[29];
    scr_ws_accept_key(key, strlen(key), accept);
    check(strcmp(accept, "HSmrc0sMlYUkAGmm5OPpG2HaGWk=") == 0, "RFC 6455 §1.2 accept vector");

    /* A well-formed 101 response — exactly the headers, no trailing data. */
    const char *ok_resp =
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: HSmrc0sMlYUkAGmm5OPpG2HaGWk=\r\n"
        "\r\n";
    size_t hlen = 0;
    check(scr_ws_check_handshake((const uint8_t *)ok_resp, strlen(ok_resp), accept, &hlen)
              == SCR_WS_HS_OK, "valid handshake OK");
    check(hlen == strlen(ok_resp), "valid handshake header_len at end");

    /* Case-insensitive names, multi-valued Connection, and a trailing
     * frame appended after the header terminator. */
    const uint8_t framed[] = {
      'H','T','T','P','/','1','.','1',' ','1','0','1',' ','x','\r','\n',
      'u','p','g','r','a','d','e',':',' ','W','e','b','S','o','c','k','e','t','\r','\n',
      'C','O','N','N','E','C','T','I','O','N',':',' ','k','e','e','p','-','a','l','i','v','e',',',' ','U','p','g','r','a','d','e','\r','\n',
      's','e','c','-','w','e','b','s','o','c','k','e','t','-','a','c','c','e','p','t',':',' ',
      'H','S','m','r','c','0','s','M','l','Y','U','k','A','G','m','m','5','O','P','p','G','2','H','a','G','W','k','=','\r','\n',
      '\r','\n',
      0x81, 0x02, 'h', 'i' /* a trailing text frame */
    };
    size_t hlen2 = 0;
    check(scr_ws_check_handshake(framed, sizeof framed, accept, &hlen2) == SCR_WS_HS_OK,
          "case-insensitive multi-valued handshake OK");
    check(hlen2 == sizeof framed - 4, "header_len points at trailing frame");

    /* Wrong accept. */
    const char *bad_accept =
        "HTTP/1.1 101 x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        "Sec-WebSocket-Accept: WRONGWRONGWRONGWRONGWRONGWR=\r\n\r\n";
    check(scr_ws_check_handshake((const uint8_t *)bad_accept, strlen(bad_accept), accept, &hlen)
              == SCR_WS_HS_BAD_ACCEPT, "bad accept rejected");

    /* Wrong status. */
    const char *bad_status =
        "HTTP/1.1 200 OK\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        "Sec-WebSocket-Accept: HSmrc0sMlYUkAGmm5OPpG2HaGWk=\r\n\r\n";
    check(scr_ws_check_handshake((const uint8_t *)bad_status, strlen(bad_status), accept, &hlen)
              == SCR_WS_HS_BAD_STATUS, "non-101 status rejected");

    /* Missing Upgrade header. */
    const char *no_up =
        "HTTP/1.1 101 x\r\nConnection: Upgrade\r\n"
        "Sec-WebSocket-Accept: HSmrc0sMlYUkAGmm5OPpG2HaGWk=\r\n\r\n";
    check(scr_ws_check_handshake((const uint8_t *)no_up, strlen(no_up), accept, &hlen)
              == SCR_WS_HS_BAD_UPGRADE, "missing upgrade rejected");

    /* Incomplete: no header terminator yet. */
    const char *partial = "HTTP/1.1 101 x\r\nUpgrade: websocket\r\n";
    check(scr_ws_check_handshake((const uint8_t *)partial, strlen(partial), accept, &hlen)
              == SCR_WS_HS_INCOMPLETE, "incomplete response waits");
  }

  run_state_machine_tests();

  fprintf(stderr, "%d/%d cases passed\n", passed, total);
  return passed == total ? 0 : 1;
}
