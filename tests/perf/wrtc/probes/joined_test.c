/* THE JOINED STACK: real UDP socket -> DTLS 1.2 -> SCTP association.
 *
 * Until now this clause had two proved halves that had never met. DTLS ran
 * over real lossy sockets; the SCTP association ran over a virtual wire.
 * Each half's clean run predicts nothing about the pair, because DTLS has
 * its own retransmission and so does SCTP, and two independent
 * retransmitters over one lossy path is where the real behaviour lives.
 *
 * Layering, which is the whole point:
 *
 *     scr_sctp_assoc  --SCTP datagram-->  mbedtls_ssl_write  --> UDP socket
 *     scr_sctp_assoc  <--SCTP datagram--  mbedtls_ssl_read   <-- UDP socket
 *
 * DTLS retransmits only its HANDSHAKE flights. Once established it does not
 * retransmit application data, so a lost SCTP packet is recovered by SCTP's
 * timer and by nothing else. That division is the property under test.
 *
 * The peer is the same hand-written scripted responder the association test
 * uses, included from one source so the two cannot diverge. It is
 * deliberately not a second instance of the implementation: a wire-format
 * bug cannot then agree with itself.
 *
 * WHAT THIS STILL IS NOT: a real WebRTC peer. Both sides here are code in
 * this repository, and the SCTP peer is one I wrote.
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
#include "scr_wrtc_fp.h"

static int fails = 0, checks = 0;
static unsigned suite_retransmits = 0; /* SCTP rtx across all cases */

static void ck(const char *what, int ok, const char *detail) {
  checks++;
  if (ok) printf("  ok   %-48s %s\n", what, detail ? detail : "");
  else {
    printf("  FAIL %-48s %s\n", what, detail ? detail : "");
    fails++;
  }
}

/* The scripted SCTP peer, shared verbatim with assoc_test.c. */
#include "sctp_peer.inc"

/* ── lossy UDP transport under DTLS ──────────────────────────────────── */

/* Drops are counted PER PHASE. The joined stack has two independent
 * retransmitters and they do not share work: DTLS recovers its own
 * handshake flights, and once established it never retransmits application
 * data, so only loss AFTER the handshake can reach SCTP. A single total
 * conflates them. */
typedef struct {
  uint32_t st;
  unsigned drop_pct;
  unsigned sent, dropped;
  int phase;              /* 0 = DTLS handshake, 1 = SCTP over DTLS */
  unsigned sent_hs, dropped_hs;
  unsigned sent_data, dropped_data;
} Wire;

static uint32_t xs32(Wire *w) {
  uint32_t x = w->st;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  w->st = x;
  return x;
}

typedef struct {
  SOCKET sock;
  struct sockaddr_in peer;
  Wire *wire;
} Transport;

static int bio_send(void *ctx, const unsigned char *buf, size_t len) {
  Transport *t = ctx;
  t->wire->sent++;
  if (t->wire->phase == 0) t->wire->sent_hs++; else t->wire->sent_data++;
  if (t->wire->drop_pct > 0 && (xs32(t->wire) % 100u) < t->wire->drop_pct) {
    t->wire->dropped++;
    if (t->wire->phase == 0) t->wire->dropped_hs++; else t->wire->dropped_data++;
    /* Report success: a dropped datagram is one the sender believes it
     * sent. Returning an error would exercise the local error path
     * instead of retransmission. */
    return (int)len;
  }
  sendto(t->sock, (const char *)buf, (int)len, 0,
         (struct sockaddr *)&t->peer, sizeof t->peer);
  return (int)len;
}

static int bio_recv(void *ctx, unsigned char *buf, size_t len) {
  Transport *t = ctx;
  struct sockaddr_in from;
  socklen_t flen = sizeof from;
  int n = recvfrom(t->sock, (char *)buf, (int)len, 0,
                   (struct sockaddr *)&from, &flen);
  if (n < 0) return MBEDTLS_ERR_SSL_WANT_READ;
  return n;
}

static SOCKET udp_bind_loopback(struct sockaddr_in *out) {
  SOCKET s = socket(AF_INET, SOCK_DGRAM, 0);
  if (s == INVALID_SOCKET) return s;
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  a.sin_port = 0;
  if (bind(s, (struct sockaddr *)&a, sizeof a) != 0) {
    closesocket(s);
    return INVALID_SOCKET;
  }
  socklen_t l = sizeof *out;
  getsockname(s, (struct sockaddr *)out, &l);
#ifdef _WIN32
  u_long nb = 1;
  ioctlsocket(s, FIONBIO, &nb);
#else
  fcntl(s, F_SETFL, O_NONBLOCK);
#endif
  return s;
}

typedef struct {
  mbedtls_ssl_context ssl;
  mbedtls_ssl_config conf;
  mbedtls_x509_crt crt;
  mbedtls_timing_delay_context timer;
  Transport tr;
  ScrWrtcCert *cert;
} Side;

static int side_init(Side *s, int is_server, SOCKET sock,
                     struct sockaddr_in peer, Wire *wire,
                     mbedtls_ctr_drbg_context *drbg) {
  s->cert = scr_wrtc_cert_generate();
  if (s->cert == NULL) return -1;
  size_t dl = 0;
  const uint8_t *der = scr_wrtc_cert_der(s->cert, &dl);
  mbedtls_x509_crt_init(&s->crt);
  if (mbedtls_x509_crt_parse_der(&s->crt, der, dl) != 0) return -1;

  mbedtls_ssl_config_init(&s->conf);
  mbedtls_ssl_init(&s->ssl);
  if (mbedtls_ssl_config_defaults(&s->conf,
        is_server ? MBEDTLS_SSL_IS_SERVER : MBEDTLS_SSL_IS_CLIENT,
        MBEDTLS_SSL_TRANSPORT_DATAGRAM, MBEDTLS_SSL_PRESET_DEFAULT) != 0)
    return -1;
  mbedtls_ssl_conf_rng(&s->conf, mbedtls_ctr_drbg_random, drbg);
  /* WebRTC authenticates by fingerprint, not by chain. */
  mbedtls_ssl_conf_authmode(&s->conf, is_server ? MBEDTLS_SSL_VERIFY_OPTIONAL
                                                : MBEDTLS_SSL_VERIFY_NONE);
  if (mbedtls_ssl_conf_own_cert(&s->conf, &s->crt,
        (mbedtls_pk_context *)scr_wrtc_cert_pk(s->cert)) != 0)
    return -1;
  if (is_server) mbedtls_ssl_conf_dtls_cookies(&s->conf, NULL, NULL, NULL);
  mbedtls_ssl_conf_handshake_timeout(&s->conf, 50, 800);
  if (mbedtls_ssl_setup(&s->ssl, &s->conf) != 0) return -1;

  s->tr.sock = sock;
  s->tr.peer = peer;
  s->tr.wire = wire;
  mbedtls_ssl_set_timer_cb(&s->ssl, &s->timer, mbedtls_timing_set_delay,
                           mbedtls_timing_get_delay);
  mbedtls_ssl_set_bio(&s->ssl, &s->tr, bio_send, bio_recv, NULL);
  return 0;
}

static void side_free(Side *s) {
  mbedtls_ssl_free(&s->ssl);
  mbedtls_ssl_config_free(&s->conf);
  mbedtls_x509_crt_free(&s->crt);
  scr_wrtc_cert_free(s->cert);
}

/* ── one joined run ──────────────────────────────────────────────────── */

static int run_case(const char *label, unsigned drop_pct, uint32_t seed,
                    int budget_ms) {
  printf("\n%s (drop=%u%%, seed=%u)\n", label, drop_pct, seed);

  struct sockaddr_in caddr, saddr;
  SOCKET csock = udp_bind_loopback(&caddr);
  SOCKET ssock = udp_bind_loopback(&saddr);
  if (csock == INVALID_SOCKET || ssock == INVALID_SOCKET) {
    ck("sockets", 0, NULL);
    return 0;
  }

  Wire wire;
  memset(&wire, 0, sizeof wire);
  wire.st = seed ? seed : 3u;
  wire.drop_pct = drop_pct;

  mbedtls_entropy_context ent;
  mbedtls_ctr_drbg_context drbg;
  mbedtls_entropy_init(&ent);
  mbedtls_ctr_drbg_init(&drbg);
  static const char pers[] = "scr-wrtc-joined";
  mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &ent,
                        (const unsigned char *)pers, sizeof pers - 1);

  Side cli, srv;
  memset(&cli, 0, sizeof cli);
  memset(&srv, 0, sizeof srv);
  int oki = side_init(&cli, 0, csock, saddr, &wire, &drbg) == 0 &&
            side_init(&srv, 1, ssock, caddr, &wire, &drbg) == 0;
  ck("both DTLS sides configured", oki, NULL);
  if (!oki) return 0;

  /* ── phase 1: the DTLS handshake, over the lossy socket ── */
  uint64_t t0 = now_ms();
  int crc = MBEDTLS_ERR_SSL_WANT_READ, src = MBEDTLS_ERR_SSL_WANT_READ;
  while ((crc != 0 || src != 0) && (int)(now_ms() - t0) < budget_ms) {
    if (crc != 0) crc = mbedtls_ssl_handshake(&cli.ssl);
    if (src != 0) src = mbedtls_ssl_handshake(&srv.ssl);
    /* A finished peer still has work: it must service the other side's
     * retransmitted flight. Learned the hard way in socket_test.c, where
     * omitting this looked like a protocol failure at 40% loss. */
    unsigned char drain[512];
    if (src == 0 && crc != 0) (void)mbedtls_ssl_read(&srv.ssl, drain, sizeof drain);
    if (crc == 0 && src != 0) (void)mbedtls_ssl_read(&cli.ssl, drain, sizeof drain);
    poll_sleep(2);
  }
  char d[160];
  snprintf(d, sizeof d, "client=%d server=%d in %dms", crc, src,
           (int)(now_ms() - t0));
  int hs_ok = (crc == 0 && src == 0);
  ck("DTLS handshake completes over the lossy socket", hs_ok, d);
  if (!hs_ok) {
    side_free(&cli); side_free(&srv);
    mbedtls_ctr_drbg_free(&drbg); mbedtls_entropy_free(&ent);
    closesocket(csock); closesocket(ssock);
    return 0;
  }

  wire.phase = 1; /* everything from here is SCTP inside DTLS */

  /* Fingerprint authentication, over the joined path. */
  const mbedtls_x509_crt *pc = mbedtls_ssl_get_peer_cert(&cli.ssl);
  uint8_t sfp[32], cfp[32], got[32];
  scr_wrtc_cert_fingerprint(srv.cert, sfp);
  scr_wrtc_cert_fingerprint(cli.cert, cfp);
  if (pc != NULL) {
    scr_wrtc_fp_of_cert(pc->raw.p, pc->raw.len, got);
    ck("peer fingerprint authenticates", scr_wrtc_fp_equal(got, sfp), NULL);
    ck("and does not match the wrong certificate",
       !scr_wrtc_fp_equal(got, cfp), NULL);
  } else {
    ck("peer certificate present", 0, NULL);
  }

  /* ── phase 2: SCTP inside the established DTLS session ── */
  ScrSctpAssoc *a = scr_sctp_assoc_new(5000, 5000, seed ? seed : 9u, now_ms());
  Peer p;
  memset(&p, 0, sizeof p);
  p.local_port = 5000;
  p.remote_port = 5000;
  p.my_tag = 0x1234ABCDu;
  p.next_tsn = 900u;

  scr_sctp_assoc_connect(a, now_ms());

  const int MSGS = 5;
  int sent_count = 0;
  int opened = 0;
  int hb_started = 0;
  uint8_t buf[2048];
  uint8_t payload[16];
  uint64_t t1 = now_ms();

  while ((int)(now_ms() - t1) < budget_ms) {
    uint64_t t = now_ms();
    scr_sctp_assoc_tick(a, t);

    /* client SCTP -> DTLS -> socket */
    size_t n;
    while ((n = scr_sctp_assoc_pop_output(a, buf, sizeof buf)) > 0)
      mbedtls_ssl_write(&cli.ssl, buf, n);

    /* socket -> DTLS -> server peer */
    for (;;) {
      int r = mbedtls_ssl_read(&srv.ssl, buf, sizeof buf);
      if (r <= 0) break;
      peer_input(&p, buf, (size_t)r);
      /* drain everything the peer owes, through DTLS */
      for (int g = 0; g < 4; g++) {
        if (p.out_len > 0) {
          mbedtls_ssl_write(&srv.ssl, p.out, p.out_len);
          p.out_len = 0;
        } else if (p.pending_dcep_ack) {
          uint8_t ack[1] = { SCR_SCTP_DCEP_DATA_CHANNEL_ACK };
          peer_send_data(&p, SCR_SCTP_PPID_DCEP, ack, 1);
          p.pending_dcep_ack = 0;
        } else break;
      }
    }

    peer_tick(&p, t);
    if (p.out_len > 0) {
      mbedtls_ssl_write(&srv.ssl, p.out, p.out_len);
      p.out_len = 0;
    }

    /* socket -> DTLS -> client SCTP */
    for (;;) {
      int r = mbedtls_ssl_read(&cli.ssl, buf, sizeof buf);
      if (r <= 0) break;
      scr_sctp_assoc_input(a, buf, (size_t)r, now_ms());
    }

    if (scr_sctp_assoc_state(a) == SCR_SCTP_ESTABLISHED && !opened) {
      scr_sctp_assoc_open_channel(a, "wa-web-call", now_ms());
      opened = 1;
    }
    if (scr_sctp_assoc_channel_open(a) && sent_count < MSGS) {
      snprintf((char *)payload, sizeof payload, "msg-%d", sent_count);
      if (scr_sctp_assoc_send(a, payload, strlen((char *)payload), now_ms()))
        sent_count++;
    }
    if (!hb_started && p.established) {
      p.hb_outstanding = 1;
      p.hb_due = now_ms();
      hb_started = 1;
    }

    if (p.data_from_client >= (unsigned)MSGS &&
        scr_sctp_assoc_channel_open(a) && hb_started && !p.hb_outstanding)
      break;
    poll_sleep(2);
  }

  ScrSctpStats st;
  scr_sctp_assoc_stats(a, &st);

  ck("SCTP association reaches ESTABLISHED inside DTLS",
     scr_sctp_assoc_state(a) == SCR_SCTP_ESTABLISHED, NULL);
  ck("DCEP channel opens inside DTLS", scr_sctp_assoc_channel_open(a), NULL);
  snprintf(d, sizeof d, "%u of %d", p.data_from_client, MSGS);
  ck("every user message arrives", p.data_from_client == (unsigned)MSGS, d);
  ck("heartbeat answered through DTLS", st.heartbeats_answered >= 1, NULL);

  snprintf(d, sizeof d,
           "sctp sent=%u rtx=%u sacks=%u dup=%u | udp %u/%u dropped"
           " (handshake %u/%u, data %u/%u)",
           st.data_sent, st.retransmits, st.sacks_received,
           st.duplicates_dropped, wire.dropped, wire.sent,
           wire.dropped_hs, wire.sent_hs, wire.dropped_data, wire.sent_data);
  printf("       %s", d);
  putchar(10);

  if (drop_pct > 0) {
    ck("the wire actually dropped datagrams", wire.dropped > 0, NULL);
    /* ONLY assert SCTP recovery when loss actually REACHED the SCTP phase.
     * DTLS shields SCTP during the handshake: it retransmits its own
     * flights, and once established it never retransmits application data.
     * So drops before the handshake completes are recovered by DTLS and
     * SCTP correctly does nothing. Asserting unconditionally turned that
     * correct behaviour into a red at 20%% loss, where all eight drops
     * landed in the handshake. */
    /* A data-phase drop does NOT imply a retransmission, and asserting it
     * was wrong twice over. Cumulative SACKs are SELF-HEALING: losing one
     * costs nothing when a later SACK carries a higher cumulative TSN, so
     * the sender never learns anything was missing. Measured here at 20%%
     * loss -- 3 of 22 data-phase datagrams dropped, rtx=0, and all five
     * messages delivered anyway.
     *
     * Retransmission is therefore reported per case and asserted once for
     * the SUITE below: it must be exercised somewhere, or the lossy runs
     * prove nothing about recovery. */
    if (wire.dropped_data == 0) {
      printf("       all loss landed in the DTLS handshake; DTLS recovered"
             " it and SCTP correctly never retransmitted");
      putchar(10);
    }
  }

  suite_retransmits += st.retransmits;

  int ok = scr_sctp_assoc_state(a) == SCR_SCTP_ESTABLISHED &&
           scr_sctp_assoc_channel_open(a) &&
           p.data_from_client == (unsigned)MSGS;

  scr_sctp_assoc_free(a);
  side_free(&cli);
  side_free(&srv);
  mbedtls_ctr_drbg_free(&drbg);
  mbedtls_entropy_free(&ent);
  closesocket(csock);
  closesocket(ssock);
  return ok;
}

int main(void) {
#ifdef _WIN32
  WSADATA wsa;
  WSAStartup(MAKEWORD(2, 2), &wsa);
#endif
  printf("JOINED: real UDP socket -> DTLS 1.2 -> SCTP association\n");
  run_case("clean", 0, 101u, 15000);
  run_case("10% loss", 10, 202u, 30000);
  run_case("20% loss", 20, 303u, 40000);
  run_case("30% loss", 30, 404u, 60000);
  /* The one retransmission assertion that is actually true: across the
   * whole suite, SCTP recovery must have been exercised at least once. */
  putchar(10);
  {
    char sd[64];
    snprintf(sd, sizeof sd, "%u across all cases", suite_retransmits);
    ck("SCTP retransmission was exercised somewhere", suite_retransmits > 0, sd);
  }
  printf("%d checks, %d failures", checks, fails);
  putchar(10);
  printf("RESULT: %s", fails ? "FAIL" : "PASS");
  putchar(10);
#ifdef _WIN32
  WSACleanup();
#endif
  return fails ? 1 : 0;
}
