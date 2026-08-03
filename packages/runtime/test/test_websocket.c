/* Offline unit tests for the RFC 6455 frame codec (scr_websocket.c),
 * pinned against the RFC's own worked examples (§5.7) plus round-trip and
 * boundary checks. Prints "<pass>/<total> cases passed" to stderr, exit 0
 * iff all passed — the runtime test-harness contract (see number.test.ts). */
#include "../src/scr_websocket.h"

#include <stdio.h>
#include <string.h>

static int total = 0, passed = 0;

static void check(int cond, const char *what) {
  total++;
  if (cond) passed++;
  else fprintf(stdout, "FAIL: %s\n", what);
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
                                    "dGhlIHNhbXBsZSBub25jZQ==", NULL);
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
    size_t n = scr_ws_build_request(req, sizeof req, "h", "/", "KKKK", "chat,superchat");
    check(n > 0 && strstr(req, "Sec-WebSocket-Protocol: chat,superchat\r\n") != NULL,
          "upgrade request protocol header");
  }
  {
    char tiny[16];
    check(scr_ws_build_request(tiny, sizeof tiny, "host", "/", "KEY", NULL) == 0,
          "upgrade request overflow returns 0");
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

  fprintf(stderr, "%d/%d cases passed\n", passed, total);
  return passed == total ? 0 : 1;
}
