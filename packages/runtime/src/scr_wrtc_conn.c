/* scr_wrtc_conn.c — see scr_wrtc_conn.h for what this is and is not.
 *
 * The pump in tests/perf/wrtc/probes/joined_test.c, moved out of a test
 * harness and into the runtime. The layering is unchanged and the two
 * halves are unchanged; what changes is who owns the `while`. There it was
 * the test; here it is scr_async.c's event loop, one turn at a time,
 * through scr_wrtc_conn_pump.
 */

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#  include <winsock2.h>
#  include <ws2tcpip.h>
   typedef int scr_socklen_t;
#else
#  include <arpa/inet.h>
#  include <fcntl.h>
#  include <netinet/in.h>
#  include <sys/socket.h>
#  include <unistd.h>
#  define closesocket(s) close(s)
#  define INVALID_SOCKET (-1)
   typedef int SOCKET;
   typedef socklen_t scr_socklen_t;
#endif

#include "mbedtls/ctr_drbg.h"
#include "mbedtls/entropy.h"
#include "mbedtls/pk.h"
#include "mbedtls/ssl.h"
#include "mbedtls/timing.h"
#include "mbedtls/x509_crt.h"

#include "scr_sctp.h"
#include "scr_sctp_assoc.h"
#include "scr_wrtc_cert.h"
#include "scr_wrtc_conn.h"
#include "scr_wrtc_fp.h"

/* One SCTP message per DATA chunk (scr_sctp_assoc.h: no fragmentation).
 * zapo's SDP writes a=max-message-size:1500 and its own send buffer caps
 * at 10 KB, so this ceiling is above what it can hand us. */
#define SCR_WRTC_MSG_MAX 1200u
#define SCR_WRTC_RX_QUEUE 32u

typedef struct {
  size_t len;
  uint8_t data[SCR_WRTC_MSG_MAX];
} ScrWrtcRxMsg;

struct ScrWrtcConn {
  SOCKET sock;
  uint16_t local_port;

  ScrWrtcCert *cert;
  uint8_t local_fp[32];
  char local_fp_text[96];
  char ufrag[5];
  char pwd[25];
  char *local_sdp; /* owned, built once */

  mbedtls_entropy_context ent;
  mbedtls_ctr_drbg_context drbg;
  mbedtls_ssl_context ssl;
  mbedtls_ssl_config conf;
  mbedtls_x509_crt own_crt;
  mbedtls_timing_delay_context timer;
  bool tls_ready; /* mbedtls contexts set up */

  struct sockaddr_in remote;
  bool have_remote;
  uint8_t remote_fp[32];
  bool have_remote_fp;

  bool handshake_done;
  bool fp_verified;
  ScrSctpAssoc *assoc;
  bool want_channel;
  char label[64];
  bool channel_requested;

  ScrWrtcTrState st;
  uint64_t deadline_ms; /* 0 = none */

  ScrWrtcRxMsg rx[SCR_WRTC_RX_QUEUE];
  size_t rx_head, rx_tail;

  uint32_t dg_sent, dg_recv, msg_sent, msg_recv;
};

/* ── the mbedtls BIO, straight onto the socket ───────────────────────── */

static int scr_wrtc_bio_send(void *ctx, const unsigned char *buf, size_t len) {
  ScrWrtcConn *c = ctx;
  if (c->sock == INVALID_SOCKET || !c->have_remote) return MBEDTLS_ERR_SSL_WANT_WRITE;
  int n = sendto(c->sock, (const char *)buf, (int)len, 0,
                 (struct sockaddr *)&c->remote, sizeof c->remote);
  if (n < 0) return MBEDTLS_ERR_SSL_WANT_WRITE;
  c->dg_sent++;
  return n;
}

/* Non-blocking: an empty socket is WANT_READ, not an error. mbedtls's own
 * retransmission timer decides when a flight is overdue -- returning a
 * hard error here would take that decision away from it. */
static int scr_wrtc_bio_recv(void *ctx, unsigned char *buf, size_t len) {
  ScrWrtcConn *c = ctx;
  if (c->sock == INVALID_SOCKET) return MBEDTLS_ERR_SSL_WANT_READ;
  struct sockaddr_in from;
  scr_socklen_t flen = (scr_socklen_t)sizeof from;
  int n = recvfrom(c->sock, (char *)buf, (int)len, 0,
                   (struct sockaddr *)&from, &flen);
  if (n < 0) return MBEDTLS_ERR_SSL_WANT_READ;
  c->dg_recv++;
  return n;
}

/* ── socket ──────────────────────────────────────────────────────────── */

static SOCKET scr_wrtc_bind_host(uint16_t *port_out) {
#ifdef _WIN32
  static bool wsa_started = false;
  if (!wsa_started) {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return INVALID_SOCKET;
    wsa_started = true;
  }
#endif
  SOCKET s = socket(AF_INET, SOCK_DGRAM, 0);
  if (s == INVALID_SOCKET) return s;
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_addr.s_addr = htonl(INADDR_ANY);
  a.sin_port = 0;
  if (bind(s, (struct sockaddr *)&a, sizeof a) != 0) {
    closesocket(s);
    return INVALID_SOCKET;
  }
  struct sockaddr_in got;
  scr_socklen_t l = (scr_socklen_t)sizeof got;
  if (getsockname(s, (struct sockaddr *)&got, &l) == 0) {
    *port_out = (uint16_t)ntohs(got.sin_port);
  }
#ifdef _WIN32
  u_long nb = 1;
  ioctlsocket(s, FIONBIO, &nb);
#else
  fcntl(s, F_SETFL, O_NONBLOCK);
#endif
  return s;
}

/* ── ICE credentials ─────────────────────────────────────────────────
 *
 * RFC 5245 s15.4: ice-ufrag is at least 4 characters and ice-pwd at least
 * 22, drawn from the ICE-char set. libwebrtc emits exactly 4 and 24 and
 * the differential probe reads both lengths off the oracle, so those are
 * the two numbers here. The alphabet is base64's, which is an ICE-char
 * subset. */
static const char SCR_WRTC_ICE_CHARS[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static void scr_wrtc_ice_text(mbedtls_ctr_drbg_context *drbg, char *out, size_t n) {
  unsigned char raw[32];
  if (n > sizeof raw) n = sizeof raw;
  if (mbedtls_ctr_drbg_random(drbg, raw, n) != 0) {
    for (size_t i = 0; i < n; i++) raw[i] = (unsigned char)(i * 7u + 3u);
  }
  for (size_t i = 0; i < n; i++) out[i] = SCR_WRTC_ICE_CHARS[raw[i] & 63u];
  out[n] = '\0';
}

/* ── the offer ───────────────────────────────────────────────────────
 *
 * Every line here is one the differential probe reads off the oracle:
 * v=0 first, CRLF throughout and a CRLF at the end, one
 * `m=application <port> UDP/DTLS/SCTP webrtc-datachannel` section,
 * a=ice-ufrag / a=ice-pwd / a=ice-options / a=fingerprint / a=setup:actpass
 * / a=mid / a=sctp-port:5000 / a=max-message-size. The host candidate is
 * the socket this connection actually bound, and zapo's
 * modifySdpForRelay strips it out of the answer it synthesises. */
static char *scr_wrtc_build_offer(ScrWrtcConn *c) {
  unsigned char sid[8];
  if (mbedtls_ctr_drbg_random(&c->drbg, sid, sizeof sid) != 0) memset(sid, 7, sizeof sid);
  uint64_t sess = 0;
  for (size_t i = 0; i < sizeof sid; i++) sess = (sess << 8) | sid[i];
  sess &= 0x1FFFFFFFFFFFFFull; /* SDP o= session id is a 64-bit decimal */

  size_t cap = 1024;
  char *s = malloc(cap);
  if (s == NULL) return NULL;
  int n = snprintf(
      s, cap,
      "v=0\r\n"
      "o=- %llu 2 IN IP4 127.0.0.1\r\n"
      "s=-\r\n"
      "t=0 0\r\n"
      "a=group:BUNDLE 0\r\n"
      "a=msid-semantic: WMS\r\n"
      "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n"
      "c=IN IP4 0.0.0.0\r\n"
      "a=ice-ufrag:%s\r\n"
      "a=ice-pwd:%s\r\n"
      "a=ice-options:trickle\r\n"
      "a=fingerprint:sha-256 %s\r\n"
      "a=setup:actpass\r\n"
      "a=mid:0\r\n"
      "a=sctp-port:5000\r\n"
      "a=max-message-size:262144\r\n"
      "a=candidate:1 1 udp 2122262783 127.0.0.1 %u typ host generation 0 network-cost 999\r\n"
      "a=end-of-candidates\r\n",
      (unsigned long long)sess, c->ufrag, c->pwd, c->local_fp_text,
      (unsigned)c->local_port);
  if (n < 0 || (size_t)n >= cap) {
    free(s);
    return NULL;
  }
  return s;
}

/* ── construction ────────────────────────────────────────────────────── */

ScrWrtcConn *scr_wrtc_conn_new(void) {
  ScrWrtcConn *c = calloc(1, sizeof *c);
  if (c == NULL) return NULL;
  c->sock = INVALID_SOCKET;
  c->st = SCR_WRTC_TR_NEW;

  mbedtls_entropy_init(&c->ent);
  mbedtls_ctr_drbg_init(&c->drbg);
  static const char pers[] = "scr-wrtc-conn";
  if (mbedtls_ctr_drbg_seed(&c->drbg, mbedtls_entropy_func, &c->ent,
                            (const unsigned char *)pers, sizeof pers - 1) != 0) {
    scr_wrtc_conn_free(c);
    return NULL;
  }

  c->sock = scr_wrtc_bind_host(&c->local_port);
  if (c->sock == INVALID_SOCKET) {
    scr_wrtc_conn_free(c);
    return NULL;
  }

  c->cert = scr_wrtc_cert_generate();
  if (c->cert == NULL || !scr_wrtc_cert_fingerprint(c->cert, c->local_fp)) {
    scr_wrtc_conn_free(c);
    return NULL;
  }
  scr_wrtc_fp_format(c->local_fp, c->local_fp_text);
  scr_wrtc_ice_text(&c->drbg, c->ufrag, 4);
  scr_wrtc_ice_text(&c->drbg, c->pwd, 24);
  return c;
}

void scr_wrtc_conn_free(ScrWrtcConn *c) {
  if (c == NULL) return;
  if (c->tls_ready) {
    mbedtls_ssl_free(&c->ssl);
    mbedtls_ssl_config_free(&c->conf);
    mbedtls_x509_crt_free(&c->own_crt);
  }
  if (c->assoc != NULL) scr_sctp_assoc_free(c->assoc);
  if (c->sock != INVALID_SOCKET) closesocket(c->sock);
  if (c->cert != NULL) scr_wrtc_cert_free(c->cert);
  mbedtls_ctr_drbg_free(&c->drbg);
  mbedtls_entropy_free(&c->ent);
  free(c->local_sdp);
  free(c);
}

ScrWrtcTrState scr_wrtc_conn_state(const ScrWrtcConn *c) {
  return c != NULL ? c->st : SCR_WRTC_TR_CLOSED;
}

const char *scr_wrtc_conn_local_sdp(ScrWrtcConn *c) {
  if (c == NULL) return "";
  if (c->local_sdp == NULL) c->local_sdp = scr_wrtc_build_offer(c);
  return c->local_sdp != NULL ? c->local_sdp : "";
}

/* ── the answer ──────────────────────────────────────────────────────── */

/* The first a=candidate host address in the answer. zapo's
 * addRelayCandidate strips every candidate the offer had and appends
 * exactly one, so "first" and "only" are the same line. */
static bool scr_wrtc_parse_candidate(const char *sdp, size_t len,
                                     struct sockaddr_in *out) {
  static const char key[] = "a=candidate:";
  const size_t klen = sizeof key - 1;
  for (size_t i = 0; i + klen < len; i++) {
    if ((i == 0 || sdp[i - 1] == '\n') && memcmp(sdp + i, key, klen) == 0) {
      size_t e = i;
      while (e < len && sdp[e] != '\r' && sdp[e] != '\n') e++;
      char line[512];
      size_t ll = e - i;
      if (ll >= sizeof line) ll = sizeof line - 1;
      memcpy(line, sdp + i, ll);
      line[ll] = '\0';
      /* a=candidate:<foundation> <component> <transport> <priority> <ip> <port> typ ... */
      char ip[64];
      unsigned port = 0;
      /* Skip the four fields before the address. */
      const char *p = line + klen;
      for (int f = 0; f < 4; f++) {
        while (*p != '\0' && *p != ' ') p++;
        while (*p == ' ') p++;
      }
      size_t k = 0;
      while (*p != '\0' && *p != ' ' && k + 1 < sizeof ip) ip[k++] = *p++;
      ip[k] = '\0';
      while (*p == ' ') p++;
      while (*p >= '0' && *p <= '9') port = port * 10u + (unsigned)(*p++ - '0');
      if (k == 0 || port == 0 || port > 65535u) continue;
      memset(out, 0, sizeof *out);
      out->sin_family = AF_INET;
      out->sin_port = htons((unsigned short)port);
      if (inet_pton(AF_INET, ip, &out->sin_addr) != 1) continue;
      return true;
    }
  }
  return false;
}

static bool scr_wrtc_start_dtls(ScrWrtcConn *c) {
  size_t dl = 0;
  const uint8_t *der = scr_wrtc_cert_der(c->cert, &dl);
  mbedtls_x509_crt_init(&c->own_crt);
  mbedtls_ssl_config_init(&c->conf);
  mbedtls_ssl_init(&c->ssl);
  c->tls_ready = true;
  if (mbedtls_x509_crt_parse_der(&c->own_crt, der, dl) != 0) return false;
  if (mbedtls_ssl_config_defaults(&c->conf, MBEDTLS_SSL_IS_CLIENT,
                                  MBEDTLS_SSL_TRANSPORT_DATAGRAM,
                                  MBEDTLS_SSL_PRESET_DEFAULT) != 0)
    return false;
  mbedtls_ssl_conf_rng(&c->conf, mbedtls_ctr_drbg_random, &c->drbg);
  /* WebRTC authenticates by FINGERPRINT, not by chain (RFC 8122). Chain
   * verification is off because there is no CA and never will be; the
   * fingerprint comparison below is not a weaker substitute for it, it is
   * the entire identity check, and it is mandatory -- a handshake that
   * completes against the wrong certificate fails the connection here. */
  mbedtls_ssl_conf_authmode(&c->conf, MBEDTLS_SSL_VERIFY_NONE);
  if (mbedtls_ssl_conf_own_cert(&c->conf, &c->own_crt,
                                (mbedtls_pk_context *)scr_wrtc_cert_pk(c->cert)) != 0)
    return false;
  mbedtls_ssl_conf_handshake_timeout(&c->conf, 50, 4000);
  if (mbedtls_ssl_setup(&c->ssl, &c->conf) != 0) return false;
  mbedtls_ssl_set_timer_cb(&c->ssl, &c->timer, mbedtls_timing_set_delay,
                           mbedtls_timing_get_delay);
  mbedtls_ssl_set_bio(&c->ssl, c, scr_wrtc_bio_send, scr_wrtc_bio_recv, NULL);
  return true;
}

bool scr_wrtc_conn_set_remote(ScrWrtcConn *c, const char *sdp, size_t len) {
  if (c == NULL || sdp == NULL) return false;
  if (!scr_wrtc_fp_from_sdp(sdp, len, c->remote_fp)) return false;
  c->have_remote_fp = true;
  if (!scr_wrtc_parse_candidate(sdp, len, &c->remote)) return false;
  c->have_remote = true;
  if (!scr_wrtc_start_dtls(c)) {
    c->st = SCR_WRTC_TR_FAILED;
    return false;
  }
  c->st = SCR_WRTC_TR_CHECKING;
  return true;
}

/* ── the pump ────────────────────────────────────────────────────────── */

static void scr_wrtc_verify_peer(ScrWrtcConn *c) {
  const mbedtls_x509_crt *pc = mbedtls_ssl_get_peer_cert(&c->ssl);
  uint8_t got[32];
  if (pc == NULL || !scr_wrtc_fp_of_cert(pc->raw.p, pc->raw.len, got) ||
      !c->have_remote_fp || !scr_wrtc_fp_equal(got, c->remote_fp)) {
    /* The one place this stack refuses a peer. A completed handshake
     * against a certificate the answer did not name is exactly the
     * man-in-the-middle RFC 8122 exists to stop, so it is a FAILED
     * connection and not a connected one with a warning. */
    c->st = SCR_WRTC_TR_FAILED;
    return;
  }
  c->fp_verified = true;
}

void scr_wrtc_conn_pump(ScrWrtcConn *c, uint64_t now_ms) {
  if (c == NULL || c->st == SCR_WRTC_TR_CLOSED || c->st == SCR_WRTC_TR_FAILED) return;
  if (c->st == SCR_WRTC_TR_NEW) return; /* no answer yet: nothing to drive */

  if (!c->handshake_done) {
    int rc = mbedtls_ssl_handshake(&c->ssl);
    if (rc == 0) {
      c->handshake_done = true;
      scr_wrtc_verify_peer(c);
      if (c->st == SCR_WRTC_TR_FAILED) return;
      /* The association's seed picks the initiate tag and the initial
       * TSN. A real caller passes CSPRNG output -- so it does. */
      unsigned char sd[4];
      uint32_t seed = 0x5EEDu;
      if (mbedtls_ctr_drbg_random(&c->drbg, sd, sizeof sd) == 0)
        seed = ((uint32_t)sd[0] << 24) | ((uint32_t)sd[1] << 16) |
               ((uint32_t)sd[2] << 8) | (uint32_t)sd[3];
      c->assoc = scr_sctp_assoc_new(5000, 5000, seed, now_ms);
      if (c->assoc == NULL) {
        c->st = SCR_WRTC_TR_FAILED;
        return;
      }
      scr_sctp_assoc_connect(c->assoc, now_ms);
    } else if (rc != MBEDTLS_ERR_SSL_WANT_READ && rc != MBEDTLS_ERR_SSL_WANT_WRITE) {
      c->st = SCR_WRTC_TR_FAILED;
      return;
    } else {
      return; /* still handshaking */
    }
  }

  if (c->assoc == NULL) return;

  scr_sctp_assoc_tick(c->assoc, now_ms);

  uint8_t buf[2048];
  size_t n;
  while ((n = scr_sctp_assoc_pop_output(c->assoc, buf, sizeof buf)) > 0) {
    int w = mbedtls_ssl_write(&c->ssl, buf, n);
    if (w < 0 && w != MBEDTLS_ERR_SSL_WANT_READ && w != MBEDTLS_ERR_SSL_WANT_WRITE) {
      c->st = SCR_WRTC_TR_FAILED;
      return;
    }
  }

  for (;;) {
    int r = mbedtls_ssl_read(&c->ssl, buf, sizeof buf);
    if (r <= 0) break;
    scr_sctp_assoc_input(c->assoc, buf, (size_t)r, now_ms);
  }

  /* Anything the input produced goes straight back out this turn: an
   * association that waits a whole loop turn to acknowledge doubles every
   * round trip. */
  while ((n = scr_sctp_assoc_pop_output(c->assoc, buf, sizeof buf)) > 0)
    (void)mbedtls_ssl_write(&c->ssl, buf, n);

  if (c->want_channel && !c->channel_requested &&
      scr_sctp_assoc_state(c->assoc) == SCR_SCTP_ESTABLISHED) {
    if (scr_sctp_assoc_open_channel(c->assoc, c->label, now_ms)) {
      c->channel_requested = true;
      while ((n = scr_sctp_assoc_pop_output(c->assoc, buf, sizeof buf)) > 0)
        (void)mbedtls_ssl_write(&c->ssl, buf, n);
    }
  }

  uint32_t ppid = 0;
  for (;;) {
    ScrWrtcRxMsg *slot = &c->rx[c->rx_tail % SCR_WRTC_RX_QUEUE];
    size_t got = scr_sctp_assoc_pop_message(c->assoc, slot->data, sizeof slot->data, &ppid);
    if (got == 0) break;
    /* PPID 50 is DOMString, 53 is binary. zapo sets binaryType
     * 'arraybuffer' and reads ev.data as bytes either way, so both are
     * queued as bytes and the PPID is not surfaced. */
    slot->len = got;
    c->rx_tail++;
    if (c->rx_tail - c->rx_head > SCR_WRTC_RX_QUEUE) c->rx_head = c->rx_tail - SCR_WRTC_RX_QUEUE;
    c->msg_recv++;
  }

  if (c->st == SCR_WRTC_TR_CHECKING && c->fp_verified &&
      scr_sctp_assoc_state(c->assoc) == SCR_SCTP_ESTABLISHED)
    c->st = SCR_WRTC_TR_CONNECTED;

  if (scr_sctp_assoc_state(c->assoc) == SCR_SCTP_ABORTED) c->st = SCR_WRTC_TR_FAILED;
}

bool scr_wrtc_conn_pending(const ScrWrtcConn *c) {
  if (c == NULL) return false;
  if (c->st == SCR_WRTC_TR_CLOSED || c->st == SCR_WRTC_TR_FAILED) return false;
  return c->st == SCR_WRTC_TR_CHECKING || c->st == SCR_WRTC_TR_CONNECTED;
}

bool scr_wrtc_conn_channel_open(const ScrWrtcConn *c) {
  return c != NULL && c->assoc != NULL && scr_sctp_assoc_channel_open(c->assoc);
}

void scr_wrtc_conn_request_channel(ScrWrtcConn *c, const char *label) {
  if (c == NULL) return;
  c->want_channel = true;
  size_t n = label != NULL ? strlen(label) : 0;
  if (n >= sizeof c->label) n = sizeof c->label - 1;
  if (n > 0) memcpy(c->label, label, n);
  c->label[n] = '\0';
}

bool scr_wrtc_conn_send(ScrWrtcConn *c, const uint8_t *data, size_t len,
                        uint64_t now_ms) {
  if (c == NULL || c->assoc == NULL || len > SCR_WRTC_MSG_MAX) return false;
  if (!scr_sctp_assoc_channel_open(c->assoc)) return false;
  if (!scr_sctp_assoc_send(c->assoc, data, len, now_ms)) return false;
  c->msg_sent++;
  uint8_t buf[2048];
  size_t n;
  while ((n = scr_sctp_assoc_pop_output(c->assoc, buf, sizeof buf)) > 0)
    (void)mbedtls_ssl_write(&c->ssl, buf, n);
  return true;
}

size_t scr_wrtc_conn_pop_message(ScrWrtcConn *c, uint8_t *buf, size_t cap) {
  if (c == NULL || c->rx_head == c->rx_tail) return 0;
  ScrWrtcRxMsg *slot = &c->rx[c->rx_head % SCR_WRTC_RX_QUEUE];
  size_t n = slot->len;
  if (n > cap) n = cap;
  memcpy(buf, slot->data, n);
  c->rx_head++;
  return n;
}

void scr_wrtc_conn_stats(const ScrWrtcConn *c, ScrWrtcConnStats *out) {
  memset(out, 0, sizeof *out);
  if (c == NULL) return;
  out->datagrams_sent = c->dg_sent;
  out->datagrams_received = c->dg_recv;
  out->messages_sent = c->msg_sent;
  out->messages_received = c->msg_recv;
  out->fingerprint_verified = c->fp_verified;
  if (c->assoc != NULL) {
    ScrSctpStats s;
    scr_sctp_assoc_stats(c->assoc, &s);
    out->sctp_retransmits = s.retransmits;
  }
}

void scr_wrtc_conn_close(ScrWrtcConn *c) {
  if (c == NULL) return;
  c->st = SCR_WRTC_TR_CLOSED;
  if (c->sock != INVALID_SOCKET) {
    closesocket(c->sock);
    c->sock = INVALID_SOCKET;
  }
}
