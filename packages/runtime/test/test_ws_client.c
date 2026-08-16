/* End-to-end for scr_ws_client: dial a real ws:// server, complete the
 * handshake over a real socket, echo a text and a binary message, close.
 *
 * The interop test proves the PROTOCOL layer against `ws`. This proves the
 * TRANSPORT half — that the driver's want_write reaches the socket, that
 * the socket's bytes reach recv, and that the whole thing runs on the
 * event loop rather than a hand-fed buffer.
 *
 * argv[1] is the port the harness's echo server printed.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scr_runtime.h"
#include "scr_ws_client.h"

static ScrWsClient *g_client;
static int g_opened, g_closed, g_errors;
static int g_msgs;
static char g_text[256];
static size_t g_bin_len;
static uint8_t g_bin[256];

static void on_open(void *u) {
  (void)u;
  g_opened++;
  scr_ws_client_send(g_client, (const uint8_t *)"hello", 5, true);
}

static void on_message(void *u, const uint8_t *d, size_t n, bool is_text) {
  (void)u;
  g_msgs++;
  if (is_text) {
    size_t k = n < sizeof g_text - 1 ? n : sizeof g_text - 1;
    memcpy(g_text, d, k);
    g_text[k] = '\0';
    /* Round two: a binary frame, which takes the other opcode path. */
    static const uint8_t payload[3] = {0xDE, 0xAD, 0x01};
    scr_ws_client_send(g_client, payload, sizeof payload, false);
    return;
  }
  g_bin_len = n < sizeof g_bin ? n : sizeof g_bin;
  memcpy(g_bin, d, g_bin_len);
  scr_ws_client_close(g_client, 1000, (const uint8_t *)"bye", 3);
}

static void on_close(void *u, uint16_t code, const uint8_t *reason, size_t rlen) {
  (void)u;
  (void)reason;
  (void)rlen;
  g_closed = code;
}

static void on_error(void *u, const char *msg) {
  (void)u;
  g_errors++;
  fprintf(stderr, "ws error: %s\n", msg);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: test_ws_client <port>\n");
    return 2;
  }
  scr_net_install();

  char url[64];
  snprintf(url, sizeof url, "ws://127.0.0.1:%s/", argv[1]);
  ScrStr *u = scr_str_new(url, strlen(url));

  static const ScrWsClientCallbacks cb = {
      .on_open = &on_open,
      .on_message = &on_message,
      .on_close = &on_close,
      .on_error = &on_error,
  };
  g_client = scr_ws_client_connect(u, NULL, NULL, &cb, NULL, NULL);
  scr_str_release(u);
  if (g_client == NULL) {
    fprintf(stderr, "connect returned NULL\n");
    return 1;
  }

  scr_loop_run(NULL);

  int fails = 0;
#define CHECK(cond, what)                     \
  do {                                        \
    if (!(cond)) {                            \
      fprintf(stderr, "FAIL: %s\n", (what));  \
      fails++;                                \
    }                                         \
  } while (0)

  CHECK(g_errors == 0, "no errors");
  CHECK(g_opened == 1, "opened exactly once");
  CHECK(g_msgs == 2, "two messages echoed back");
  CHECK(strcmp(g_text, "hello") == 0, "text frame round-trips");
  CHECK(g_bin_len == 3 && g_bin[0] == 0xDE && g_bin[1] == 0xAD && g_bin[2] == 0x01,
        "binary frame round-trips");
  CHECK(g_closed == 1000, "close code 1000");
  CHECK(scr_ws_client_ready_state(g_client) == SCR_WS_CLOSED, "readyState CLOSED");

  scr_ws_client_free(g_client);
  if (fails == 0) fprintf(stderr, "7/7 checks passed\n");
  return fails == 0 ? 0 : 1;
}
