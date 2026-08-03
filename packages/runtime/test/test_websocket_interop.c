/* Interop client: connects to a real `ws` echo server over a blocking
 * TCP socket, drives scr_ws_conn through the handshake, sends messages,
 * and verifies the echoes come back byte-identical. Proves the state
 * machine interoperates with the reference implementation end to end —
 * in particular that our Upgrade REQUEST is accepted (unit tests only
 * cover response parsing) and our masked frames decode in real ws.
 *
 * Portable sockets (winsock on Windows, BSD sockets elsewhere); a blocking
 * recv loop, so no event loop is needed for the test.
 * Usage: ws_interop_client <port> */
#include "scr_websocket.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
typedef SOCKET sock_t;
#define SOCK_CLOSE closesocket
#define SOCK_STARTUP() do { WSADATA w; WSAStartup(MAKEWORD(2,2), &w); } while (0)
#define SOCK_CLEANUP() WSACleanup()
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
typedef int sock_t;
#define SOCK_CLOSE close
#define SOCK_STARTUP() ((void)0)
#define SOCK_CLEANUP() ((void)0)
#endif

typedef struct {
  sock_t sock;
  int open;
  int errors;
  int closed;
  char msgs[16][512];
  size_t msg_lens[16];
  int is_bin[16];
  int msg_count;
} Cli;

static void c_open(void *u) { ((Cli *)u)->open = 1; }
static void c_msg(void *u, const uint8_t *d, size_t n, bool text) {
  Cli *c = (Cli *)u;
  if (c->msg_count < 16) {
    size_t k = n < 512 ? n : 512;
    memcpy(c->msgs[c->msg_count], d, k);
    c->msg_lens[c->msg_count] = k;
    c->is_bin[c->msg_count] = !text;
    c->msg_count++;
  }
}
static void c_close(void *u, uint16_t code, const uint8_t *r, size_t rn) {
  (void)code; (void)r; (void)rn; ((Cli *)u)->closed = 1;
}
static void c_err(void *u, const char *m) { ((Cli *)u)->errors++; fprintf(stderr, "WS ERROR: %s\n", m); }
static void c_write(void *u, const uint8_t *d, size_t n) {
  Cli *c = (Cli *)u;
  size_t sent = 0;
  while (sent < n) {
    int r = send(c->sock, (const char *)d + sent, (int)(n - sent), 0);
    if (r <= 0) { c->errors++; return; }
    sent += (size_t)r;
  }
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: %s <port>\n", argv[0]); return 2; }
  int port = atoi(argv[1]);

  SOCK_STARTUP();

  sock_t s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof addr);
  addr.sin_family = AF_INET;
  addr.sin_port = htons((unsigned short)port);
  inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
  if (connect(s, (struct sockaddr *)&addr, sizeof addr) != 0) {
    fprintf(stderr, "connect failed\n");
    return 4;
  }

  Cli cli;
  memset(&cli, 0, sizeof cli);
  cli.sock = s;

  /* Build the handshake request with a fixed nonce and its expected accept. */
  const uint8_t seed16[16] = {1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16};
  char key_b64[25];
  scr_ws_key_b64(seed16, key_b64);
  char accept[29];
  scr_ws_accept_key(key_b64, strlen(key_b64), accept);

  ScrWsCallbacks cb = { c_open, c_msg, c_close, c_err, c_write };
  const uint8_t mask_seed[4] = {0xDE, 0xAD, 0xBE, 0xEF};
  ScrWsConn *conn = scr_ws_conn_new(accept, &cb, &cli, mask_seed);

  char req[512];
  char host[64];
  snprintf(host, sizeof host, "127.0.0.1:%d", port);
  size_t reqn = scr_ws_build_request(req, sizeof req, host, "/", key_b64, NULL);
  size_t sent = 0;
  while (sent < reqn) {
    int r = send(s, req + sent, (int)(reqn - sent), 0);
    if (r <= 0) { fprintf(stderr, "send request failed\n"); return 5; }
    sent += (size_t)r;
  }

  /* Blocking recv loop: drive the handshake, then messages. */
  uint8_t buf[4096];
  int sent_msgs = 0;
  const char *m1 = "hello interop";
  const uint8_t m2[] = {0x00, 0x01, 0xFE, 0xFF, 0x42};
  for (;;) {
    int n = recv(s, (char *)buf, sizeof buf, 0);
    if (n <= 0) { scr_ws_conn_eof(conn); break; }
    if (!scr_ws_conn_recv(conn, buf, (size_t)n)) break;
    if (cli.open && sent_msgs == 0) {
      scr_ws_conn_send(conn, (const uint8_t *)m1, strlen(m1), true);
      scr_ws_conn_send(conn, m2, sizeof m2, false);
      sent_msgs = 1;
    }
    if (cli.msg_count >= 2) {
      scr_ws_conn_close(conn, 1000, NULL, 0);
      /* let the close flush, then stop */
      SOCK_CLOSE(s);
      break;
    }
  }

  scr_ws_conn_free(conn);
  SOCK_CLEANUP();

  /* Verify the echoes. */
  int ok = 1;
  if (!cli.open) { fprintf(stderr, "never opened\n"); ok = 0; }
  if (cli.errors) { fprintf(stderr, "errors: %d\n", cli.errors); ok = 0; }
  if (cli.msg_count < 2) { fprintf(stderr, "got %d messages\n", cli.msg_count); ok = 0; }
  else {
    if (cli.is_bin[0] || cli.msg_lens[0] != strlen(m1) ||
        memcmp(cli.msgs[0], m1, strlen(m1)) != 0) { fprintf(stderr, "echo 1 mismatch\n"); ok = 0; }
    if (!cli.is_bin[1] || cli.msg_lens[1] != sizeof m2 ||
        memcmp(cli.msgs[1], m2, sizeof m2) != 0) { fprintf(stderr, "echo 2 mismatch\n"); ok = 0; }
  }
  fprintf(stderr, ok ? "INTEROP OK\n" : "INTEROP FAIL\n");
  return ok ? 0 : 1;
}
