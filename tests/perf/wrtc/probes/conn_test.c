/* conn_test.c — the RUNTIME transport unit, driven the way the event loop
 * drives it.
 *
 * joined_test.c proved the layering with the pump written inline in the
 * test. This proves scr_wrtc_conn.c: the same layering, but the client
 * side is now the runtime unit the compiler links, driven ONLY through
 * scr_wrtc_conn_pump(conn, now) -- one call per turn, exactly what
 * scr_wrtc.c's loop hook does. If this passes and the compiled binary does
 * not, the fault is in the lowering, not the transport.
 *
 * The remote side is the same hand-written scripted SCTP peer, behind a
 * DTLS server. Both sides are still code in this repository; nothing here
 * has met a real WebRTC peer.
 *
 * The answer SDP is synthesised by the SAME rewrite zapo performs
 * (modifySdpForRelay: setup:passive, ufrag/pwd/fingerprint replaced,
 * ice-options deleted, every candidate stripped and one relay candidate
 * appended) so the parser meets zapo's actual output shape and not a
 * convenient one.
 */
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  define poll_sleep(ms) Sleep(ms)
   typedef int socklen_t;
   static uint64_t now_ms(void) { return (uint64_t)GetTickCount64(); }
#else
#  include <arpa/inet.h>
#  include <fcntl.h>
#  include <netinet/in.h>
#  include <sys/socket.h>
#  include <time.h>
#  include <unistd.h>
#  define poll_sleep(ms) usleep((ms) * 1000)
#  define closesocket(s) close(s)
#  define INVALID_SOCKET (-1)
   typedef int SOCKET;
   static uint64_t now_ms(void) {
     struct timespec t;
     clock_gettime(CLOCK_MONOTONIC, &t);
     return (uint64_t)t.tv_sec * 1000u + (uint64_t)(t.tv_nsec / 1000000);
   }
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

static int fails = 0, checks = 0;

static void ck(const char *what, int ok, const char *detail) {
  checks++;
  if (ok) printf("  ok   %-50s %s\n", what, detail ? detail : "");
  else {
    printf("  FAIL %-50s %s\n", what, detail ? detail : "");
    fails++;
  }
}

#include "sctp_peer.inc"

/* ── the DTLS server side ────────────────────────────────────────────── */

typedef struct {
  SOCKET sock;
  struct sockaddr_in peer;
  bool have_peer;
  unsigned drop_pct;
  uint32_t rnd;
  unsigned sent, dropped;
} SrvIo;

static uint32_t xs32(uint32_t *s) {
  uint32_t x = *s;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  *s = x;
  return x;
}

static int srv_send(void *ctx, const unsigned char *buf, size_t len) {
  SrvIo *t = ctx;
  if (!t->have_peer) return MBEDTLS_ERR_SSL_WANT_WRITE;
  t->sent++;
  if (t->drop_pct > 0 && (xs32(&t->rnd) % 100u) < t->drop_pct) {
    t->dropped++;
    return (int)len; /* a dropped datagram is one the sender believes it sent */
  }
  sendto(t->sock, (const char *)buf, (int)len, 0,
         (struct sockaddr *)&t->peer, sizeof t->peer);
  return (int)len;
}

static int srv_recv(void *ctx, unsigned char *buf, size_t len) {
  SrvIo *t = ctx;
  struct sockaddr_in from;
  socklen_t flen = sizeof from;
  int n = recvfrom(t->sock, (char *)buf, (int)len, 0,
                   (struct sockaddr *)&from, &flen);
  if (n < 0) return MBEDTLS_ERR_SSL_WANT_READ;
  /* Learn the client's address from its first datagram, which is what a
   * relay does: the offerer's host candidate is not in the answer. */
  t->peer = from;
  t->have_peer = true;
  return n;
}

typedef struct {
  mbedtls_ssl_context ssl;
  mbedtls_ssl_config conf;
  mbedtls_x509_crt crt;
  mbedtls_timing_delay_context timer;
  mbedtls_entropy_context ent;
  mbedtls_ctr_drbg_context drbg;
  ScrWrtcCert *cert;
  SrvIo io;
  uint16_t port;
} Srv;

static bool srv_init(Srv *s, unsigned drop_pct) {
  memset(s, 0, sizeof *s);
  mbedtls_entropy_init(&s->ent);
  mbedtls_ctr_drbg_init(&s->drbg);
  static const char pers[] = "scr-wrtc-conn-test-srv";
  if (mbedtls_ctr_drbg_seed(&s->drbg, mbedtls_entropy_func, &s->ent,
                            (const unsigned char *)pers, sizeof pers - 1) != 0)
    return false;
  s->cert = scr_wrtc_cert_generate();
  if (s->cert == NULL) return false;
  size_t dl = 0;
  const uint8_t *der = scr_wrtc_cert_der(s->cert, &dl);
  mbedtls_x509_crt_init(&s->crt);
  if (mbedtls_x509_crt_parse_der(&s->crt, der, dl) != 0) return false;

  s->io.sock = socket(AF_INET, SOCK_DGRAM, 0);
  if (s->io.sock == INVALID_SOCKET) return false;
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  a.sin_port = 0;
  if (bind(s->io.sock, (struct sockaddr *)&a, sizeof a) != 0) return false;
  struct sockaddr_in got;
  socklen_t l = sizeof got;
  getsockname(s->io.sock, (struct sockaddr *)&got, &l);
  s->port = (uint16_t)ntohs(got.sin_port);
#ifdef _WIN32
  u_long nb = 1;
  ioctlsocket(s->io.sock, FIONBIO, &nb);
#else
  fcntl(s->io.sock, F_SETFL, O_NONBLOCK);
#endif
  s->io.drop_pct = drop_pct;
  s->io.rnd = 0x9E3779B9u ^ (uint32_t)s->port;

  mbedtls_ssl_config_init(&s->conf);
  mbedtls_ssl_init(&s->ssl);
  if (mbedtls_ssl_config_defaults(&s->conf, MBEDTLS_SSL_IS_SERVER,
                                  MBEDTLS_SSL_TRANSPORT_DATAGRAM,
                                  MBEDTLS_SSL_PRESET_DEFAULT) != 0)
    return false;
  mbedtls_ssl_conf_rng(&s->conf, mbedtls_ctr_drbg_random, &s->drbg);
  mbedtls_ssl_conf_authmode(&s->conf, MBEDTLS_SSL_VERIFY_NONE);
  if (mbedtls_ssl_conf_own_cert(&s->conf, &s->crt,
                                (mbedtls_pk_context *)scr_wrtc_cert_pk(s->cert)) != 0)
    return false;
  mbedtls_ssl_conf_dtls_cookies(&s->conf, NULL, NULL, NULL);
  mbedtls_ssl_conf_handshake_timeout(&s->conf, 50, 4000);
  if (mbedtls_ssl_setup(&s->ssl, &s->conf) != 0) return false;
  mbedtls_ssl_set_timer_cb(&s->ssl, &s->timer, mbedtls_timing_set_delay,
                           mbedtls_timing_get_delay);
  mbedtls_ssl_set_bio(&s->ssl, &s->io, srv_send, srv_recv, NULL);
  return true;
}

static void srv_free(Srv *s) {
  mbedtls_ssl_free(&s->ssl);
  mbedtls_ssl_config_free(&s->conf);
  mbedtls_x509_crt_free(&s->crt);
  scr_wrtc_cert_free(s->cert);
  mbedtls_ctr_drbg_free(&s->drbg);
  mbedtls_entropy_free(&s->ent);
  if (s->io.sock != INVALID_SOCKET) closesocket(s->io.sock);
}

/* ── zapo's answer, synthesised from our own offer ───────────────────── */

/* Replace every line beginning `key` with `key<value>`; delete the line
 * entirely when `value` is NULL. The rewrite zapo does with four regexes,
 * done once here so the parser meets that exact output. */
static void sdp_rewrite(char *dst, size_t cap, const char *src,
                        const char *key, const char *value) {
  size_t o = 0, i = 0;
  size_t klen = strlen(key);
  size_t slen = strlen(src);
  while (i < slen) {
    size_t e = i;
    while (e < slen && src[e] != '\n') e++;
    size_t line_end = e < slen ? e + 1 : e;
    bool hit = (line_end - i) >= klen && memcmp(src + i, key, klen) == 0;
    if (hit && value == NULL) {
      /* deleted */
    } else if (hit) {
      int n = snprintf(dst + o, cap - o, "%s%s\r\n", key, value);
      if (n > 0) o += (size_t)n;
    } else {
      size_t n = line_end - i;
      if (o + n < cap) {
        memcpy(dst + o, src + i, n);
        o += n;
      }
    }
    i = line_end;
  }
  dst[o < cap ? o : cap - 1] = '\0';
}

static void build_answer(char *out, size_t cap, const char *offer,
                         const char *fp_text, uint16_t relay_port) {
  static char a[4096], b[4096];
  sdp_rewrite(a, sizeof a, offer, "a=setup:", "passive");
  sdp_rewrite(b, sizeof b, a, "a=ice-ufrag:", "RELAYUFRAG");
  sdp_rewrite(a, sizeof a, b, "a=ice-pwd:", "RELAYPASSWORDRELAYPASSWORD");
  char fpline[160];
  snprintf(fpline, sizeof fpline, "sha-256 %s", fp_text);
  sdp_rewrite(b, sizeof b, a, "a=fingerprint:", fpline);
  sdp_rewrite(a, sizeof a, b, "a=max-message-size:", "1500");
  sdp_rewrite(b, sizeof b, a, "a=ice-options:", NULL);
  sdp_rewrite(a, sizeof a, b, "a=candidate:", NULL);
  sdp_rewrite(b, sizeof b, a, "a=end-of-candidates", NULL);
  snprintf(out, cap,
           "%sa=candidate:2 1 udp 2122262783 127.0.0.1 %u typ host generation 0 "
           "network-cost 5\r\na=end-of-candidates\r\n",
           b, (unsigned)relay_port);
}

/* ── one run ─────────────────────────────────────────────────────────── */

/* `wrong_fp` makes the answer name a certificate the server does not hold,
 * which must FAIL rather than connect: that is the whole of RFC 8122's
 * authentication and the only identity check WebRTC has. */
static void run_case(const char *label, unsigned drop_pct, bool wrong_fp,
                     int budget_ms) {
  printf("\n%s (drop=%u%%%s)\n", label, drop_pct, wrong_fp ? ", WRONG fingerprint" : "");

  ScrWrtcConn *c = scr_wrtc_conn_new();
  ck("transport constructs (socket bound, identity generated)", c != NULL, NULL);
  if (c == NULL) return;

  Srv srv;
  if (!srv_init(&srv, drop_pct)) {
    ck("server side configured", 0, NULL);
    scr_wrtc_conn_free(c);
    return;
  }
  ck("server side configured", 1, NULL);

  const char *offer = scr_wrtc_conn_local_sdp(c);
  ck("offer is generated", offer != NULL && strncmp(offer, "v=0\r\n", 5) == 0, NULL);
  ck("offer carries our host candidate",
     strstr(offer, "a=candidate:1 1 udp") != NULL, NULL);

  uint8_t fp[32];
  scr_wrtc_cert_fingerprint(srv.cert, fp);
  if (wrong_fp) fp[0] ^= 0xFFu; /* one flipped byte: the minimum lie */
  char fp_text[96];
  scr_wrtc_fp_format(fp, fp_text);

  static char answer[8192];
  build_answer(answer, sizeof answer, offer, fp_text, srv.port);
  ck("answer carries setup:passive", strstr(answer, "a=setup:passive") != NULL, NULL);
  ck("answer has no a=ice-options line", strstr(answer, "a=ice-options") == NULL, NULL);

  scr_wrtc_conn_request_channel(c, "wa-web-call");
  bool applied = scr_wrtc_conn_set_remote(c, answer, strlen(answer));
  ck("remote answer applied (fingerprint + candidate parsed)", applied, NULL);
  if (!applied) {
    srv_free(&srv);
    scr_wrtc_conn_free(c);
    return;
  }

  Peer p;
  memset(&p, 0, sizeof p);
  p.local_port = 5000;
  p.remote_port = 5000;
  p.my_tag = 0x1234ABCDu;
  p.next_tsn = 900u;

  int srv_hs = MBEDTLS_ERR_SSL_WANT_READ;
  bool sent_one = false, echoed = false;
  int received = 0;
  uint8_t rx[2048];
  uint64_t t0 = now_ms();

  /* THE LOOP TURN. The client side is driven by exactly one call --
   * scr_wrtc_conn_pump -- which is what scr_wrtc.c's loop hook does. */
  while ((int)(now_ms() - t0) < budget_ms) {
    uint64_t t = now_ms();
    scr_wrtc_conn_pump(c, t);

    if (srv_hs != 0) {
      srv_hs = mbedtls_ssl_handshake(&srv.ssl);
    } else {
      for (;;) {
        int r = mbedtls_ssl_read(&srv.ssl, rx, sizeof rx);
        if (r <= 0) break;
        peer_input(&p, rx, (size_t)r);
        for (int g = 0; g < 4; g++) {
          if (p.out_len > 0) {
            mbedtls_ssl_write(&srv.ssl, p.out, p.out_len);
            p.out_len = 0;
          } else if (p.pending_dcep_ack) {
            uint8_t ack[1] = { SCR_SCTP_DCEP_DATA_CHANNEL_ACK };
            peer_send_data(&p, SCR_SCTP_PPID_DCEP, ack, 1);
            p.pending_dcep_ack = false;
            mbedtls_ssl_write(&srv.ssl, p.out, p.out_len);
            p.out_len = 0;
          } else break;
        }
      }
      peer_tick(&p, t);
      if (p.out_len > 0) {
        mbedtls_ssl_write(&srv.ssl, p.out, p.out_len);
        p.out_len = 0;
      }
      /* The relay answers the first user message once, so the client has
       * a real inbound message to pop. */
      if (p.data_from_client >= 1 && !echoed) {
        static const uint8_t reply[] = "relay-says-hello";
        peer_send_data(&p, SCR_SCTP_PPID_BINARY, reply, sizeof reply - 1);
        mbedtls_ssl_write(&srv.ssl, p.out, p.out_len);
        p.out_len = 0;
        echoed = true;
      }
    }

    if (!sent_one && scr_wrtc_conn_channel_open(c)) {
      static const uint8_t msg[] = "hello-from-scriptc";
      if (scr_wrtc_conn_send(c, msg, sizeof msg - 1, t)) sent_one = true;
    }
    size_t got = scr_wrtc_conn_pop_message(c, rx, sizeof rx);
    if (got > 0) received++;

    if (wrong_fp && scr_wrtc_conn_state(c) == SCR_WRTC_TR_FAILED) break;
    if (!wrong_fp && received > 0 && sent_one) break;
    poll_sleep(1);
  }

  ScrWrtcConnStats st;
  scr_wrtc_conn_stats(c, &st);
  char d[200];

  if (wrong_fp) {
    ck("a certificate the answer did not name is REFUSED",
       scr_wrtc_conn_state(c) == SCR_WRTC_TR_FAILED, NULL);
    ck("and the channel never opened", !scr_wrtc_conn_channel_open(c), NULL);
    ck("and no message was delivered", received == 0, NULL);
  } else {
    ck("fingerprint verified against the answer", st.fingerprint_verified, NULL);
    ck("transport reaches CONNECTED",
       scr_wrtc_conn_state(c) == SCR_WRTC_TR_CONNECTED, NULL);
    ck("DCEP channel is open", scr_wrtc_conn_channel_open(c), NULL);
    ck("a message left through DTLS+SCTP", sent_one, NULL);
    ck("a message arrived back and popped", received > 0, NULL);
    snprintf(d, sizeof d, "udp sent=%u recv=%u | sctp rtx=%u | msgs out=%u in=%u | srv dropped %u/%u",
             st.datagrams_sent, st.datagrams_received, st.sctp_retransmits,
             st.messages_sent, st.messages_received, srv.io.dropped, srv.io.sent);
    printf("       %s\n", d);
  }

  srv_free(&srv);
  scr_wrtc_conn_free(c);
}

int main(void) {
#ifdef _WIN32
  WSADATA wsa;
  WSAStartup(MAKEWORD(2, 2), &wsa);
#endif
  printf("scr_wrtc_conn.c — the runtime transport, driven one pump call per turn\n");
  run_case("clean", 0, false, 12000);
  run_case("10% loss", 10, false, 20000);
  run_case("30% loss", 30, false, 30000);
  run_case("wrong fingerprint", 0, true, 12000);
  printf("\n%d checks, %d failures\nRESULT: %s\n", checks, fails,
         fails == 0 ? "PASS" : "FAIL");
  return fails == 0 ? 0 : 1;
}
