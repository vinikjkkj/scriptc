/* DTLS 1.2 over a REAL UDP socket, deliberately lossy.
 *
 * handshake_test.c proved the crypto over an in-memory transport that was
 * lossless and ordered by construction. It therefore said nothing about the
 * two things a real network does, and its never-expiring timer callback was
 * correct only because nothing ever needed retransmitting. This is the test
 * that removes both excuses:
 *
 *   - REAL sockets. Every datagram goes through the kernel's loopback path,
 *     so record boundaries, MTU and the non-blocking WANT_READ cycle are the
 *     real ones rather than a queue that behaves.
 *   - REAL timers. mbedtls_timing_set_delay/get_delay over a real clock, so
 *     the retransmission timer actually expires and actually fires.
 *   - DELIBERATE loss and reordering, seeded and reproducible. Waiting for
 *     the network to drop something is not a test; a handshake that has
 *     never lost a packet is not a handshake that works.
 *
 * The loss is applied in the send path before sendto, which is
 * indistinguishable from a drop on the wire.
 *
 * NOT REPRODUCIBLE FROM THE SEED, despite the seed argument. The PRNG is
 * drawn once per SEND, and with real timers the number and timing of sends
 * depends on wall-clock scheduling, so the same seed explores a different
 * loss pattern on each run. That was MEASURED, not assumed: one 40%-loss
 * case exhausted a 30 s budget on one run and completed in 145 ms on the
 * next, same seed, same binary. This is therefore a RANDOMISED test -- a
 * single green run is weak evidence, and the signal worth reading is the
 * failure rate over repeats.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  define poll_sleep(ms) Sleep(ms)
   typedef int socklen_t;
#else
#  include <arpa/inet.h>
#  include <fcntl.h>
#  include <netinet/in.h>
#  include <sys/socket.h>
#  include <unistd.h>
#  define poll_sleep(ms) usleep((ms) * 1000)
#  define closesocket(s) close(s)
#  define INVALID_SOCKET (-1)
   typedef int SOCKET;
#endif

#include "mbedtls/ctr_drbg.h"
#include "mbedtls/entropy.h"
#include "mbedtls/pk.h"
#include "mbedtls/ssl.h"
#include "mbedtls/timing.h"
#include "mbedtls/x509_crt.h"

#include "scr_wrtc_cert.h"
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

/* ── the deliberate impairment ────────────────────────────────────────
 * A tiny reproducible PRNG (xorshift32) rather than rand(), so a failure
 * can be replayed exactly from its seed. */
typedef struct {
  uint32_t state;
  unsigned drop_pct;   /* percentage of datagrams discarded outright */
  unsigned reorder_pct;/* percentage held back one slot to swap order */
  /* the held-back datagram, if any */
  unsigned char held[2048];
  size_t held_len;
  int has_held;
  SOCKET held_sock;
  struct sockaddr_in held_to;
  /* counters, so the test can PROVE the impairment actually happened
   * rather than assume it did */
  unsigned sent, dropped, reordered;
} Impair;

static uint32_t xs32(Impair *i) {
  uint32_t x = i->state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  i->state = x;
  return x;
}

typedef struct {
  SOCKET sock;
  struct sockaddr_in peer;
  Impair *imp;
} Transport;

static int bio_send(void *ctx, const unsigned char *buf, size_t len) {
  Transport *t = ctx;
  Impair *im = t->imp;
  im->sent++;

  if (im->drop_pct > 0 && (xs32(im) % 100u) < im->drop_pct) {
    im->dropped++;
    /* Report SUCCESS to mbedtls: a dropped datagram is one the sender
     * believes it sent. Reporting an error here would exercise the local
     * error path instead of retransmission, which is the opposite of what
     * this test is for. */
    return (int)len;
  }

  /* Reordering: hold this datagram, send the NEXT one first, then release
   * the held one behind it. */
  if (im->reorder_pct > 0 && !im->has_held && len < sizeof im->held &&
      (xs32(im) % 100u) < im->reorder_pct) {
    memcpy(im->held, buf, len);
    im->held_len = len;
    im->held_sock = t->sock;
    im->held_to = t->peer;
    im->has_held = 1;
    im->reordered++;
    return (int)len;
  }

  sendto(t->sock, (const char *)buf, (int)len, 0,
         (struct sockaddr *)&t->peer, sizeof t->peer);

  if (im->has_held) {
    sendto(im->held_sock, (const char *)im->held, (int)im->held_len, 0,
           (struct sockaddr *)&im->held_to, sizeof im->held_to);
    im->has_held = 0;
  }
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
  a.sin_port = 0; /* ephemeral */
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

/* One full handshake + data exchange under a given impairment. Returns 1 on
 * success. `label` names the scenario in the output. */
static int run_case(const char *label, unsigned drop_pct, unsigned reorder_pct,
                    uint32_t seed, int budget_ms, uint32_t rt_min, uint32_t rt_max) {
  printf("\n%s (drop=%u%% reorder=%u%% seed=%u)\n", label, drop_pct, reorder_pct, seed);

  ScrWrtcCert *cc = scr_wrtc_cert_generate();
  ScrWrtcCert *sc = scr_wrtc_cert_generate();
  if (cc == NULL || sc == NULL) { ck("certificates", 0, NULL); return 0; }
  uint8_t cfp[32], sfp[32];
  scr_wrtc_cert_fingerprint(cc, cfp);
  scr_wrtc_cert_fingerprint(sc, sfp);

  size_t cl = 0, sl = 0;
  const uint8_t *cd = scr_wrtc_cert_der(cc, &cl);
  const uint8_t *sd = scr_wrtc_cert_der(sc, &sl);
  mbedtls_x509_crt cx, sx;
  mbedtls_x509_crt_init(&cx);
  mbedtls_x509_crt_init(&sx);
  mbedtls_x509_crt_parse_der(&cx, cd, cl);
  mbedtls_x509_crt_parse_der(&sx, sd, sl);

  struct sockaddr_in caddr, saddr;
  SOCKET csock = udp_bind_loopback(&caddr);
  SOCKET ssock = udp_bind_loopback(&saddr);
  ck("two real UDP sockets bound on loopback",
     csock != INVALID_SOCKET && ssock != INVALID_SOCKET, NULL);
  if (csock == INVALID_SOCKET || ssock == INVALID_SOCKET) return 0;

  Impair imp;
  memset(&imp, 0, sizeof imp);
  imp.state = seed ? seed : 1u;
  imp.drop_pct = drop_pct;
  imp.reorder_pct = reorder_pct;

  Transport ct = { csock, saddr, &imp };
  Transport st = { ssock, caddr, &imp };

  mbedtls_entropy_context ent;
  mbedtls_ctr_drbg_context drbg;
  mbedtls_entropy_init(&ent);
  mbedtls_ctr_drbg_init(&drbg);
  static const char pers[] = "scr-wrtc-socket";
  mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &ent,
                        (const unsigned char *)pers, sizeof pers - 1);

  mbedtls_ssl_config cconf, sconf;
  mbedtls_ssl_context cssl, sssl;
  mbedtls_ssl_config_init(&cconf);
  mbedtls_ssl_config_init(&sconf);
  mbedtls_ssl_init(&cssl);
  mbedtls_ssl_init(&sssl);
  mbedtls_ssl_config_defaults(&cconf, MBEDTLS_SSL_IS_CLIENT,
                              MBEDTLS_SSL_TRANSPORT_DATAGRAM,
                              MBEDTLS_SSL_PRESET_DEFAULT);
  mbedtls_ssl_config_defaults(&sconf, MBEDTLS_SSL_IS_SERVER,
                              MBEDTLS_SSL_TRANSPORT_DATAGRAM,
                              MBEDTLS_SSL_PRESET_DEFAULT);
  mbedtls_ssl_conf_rng(&cconf, mbedtls_ctr_drbg_random, &drbg);
  mbedtls_ssl_conf_rng(&sconf, mbedtls_ctr_drbg_random, &drbg);
  mbedtls_ssl_conf_authmode(&cconf, MBEDTLS_SSL_VERIFY_NONE);
  mbedtls_ssl_conf_authmode(&sconf, MBEDTLS_SSL_VERIFY_OPTIONAL);
  mbedtls_ssl_conf_own_cert(&cconf, &cx, (mbedtls_pk_context *)scr_wrtc_cert_pk(cc));
  mbedtls_ssl_conf_own_cert(&sconf, &sx, (mbedtls_pk_context *)scr_wrtc_cert_pk(sc));
  mbedtls_ssl_conf_dtls_cookies(&sconf, NULL, NULL, NULL);
  /* Retransmission window. The floor matters under loss: too long and the
   * budget expires before a lost flight is resent. */
  mbedtls_ssl_conf_handshake_timeout(&cconf, rt_min, rt_max);
  mbedtls_ssl_conf_handshake_timeout(&sconf, rt_min, rt_max);

  mbedtls_ssl_setup(&cssl, &cconf);
  mbedtls_ssl_setup(&sssl, &sconf);

  /* REAL timers over a real clock -- the whole point of this file. */
  mbedtls_timing_delay_context ctimer, stimer;
  mbedtls_ssl_set_timer_cb(&cssl, &ctimer, mbedtls_timing_set_delay,
                           mbedtls_timing_get_delay);
  mbedtls_ssl_set_timer_cb(&sssl, &stimer, mbedtls_timing_set_delay,
                           mbedtls_timing_get_delay);
  mbedtls_ssl_set_bio(&cssl, &ct, bio_send, bio_recv, NULL);
  mbedtls_ssl_set_bio(&sssl, &st, bio_send, bio_recv, NULL);

  int crc = MBEDTLS_ERR_SSL_WANT_READ, src = MBEDTLS_ERR_SSL_WANT_READ;
  int elapsed = 0;
  while ((crc != 0 || src != 0) && elapsed < budget_ms) {
    if (crc != 0) crc = mbedtls_ssl_handshake(&cssl);
    if (src != 0) src = mbedtls_ssl_handshake(&sssl);
    /* A peer that has FINISHED still has work to do. When the server's
     * last flight is lost the client sits in WANT_READ and retransmits,
     * but the server's handshake already returned 0 -- so unless something
     * keeps reading on the server it never sees the retransmission and
     * never resends, and the client waits until the budget expires.
     *
     * This is what the 40%-loss failures actually were: every one of them
     * showed server=0 with the client stuck, in BOTH ceiling variants,
     * which is why changing the retransmission ceiling did nothing. It was
     * the harness, not the protocol. A real application is always reading
     * on an established connection, and mbedtls_ssl_read is what processes
     * a retransmitted handshake flight. */
    if (src == 0 && crc != 0) {
      unsigned char drain[512];
      (void)mbedtls_ssl_read(&sssl, drain, sizeof drain);
    }
    if (crc == 0 && src != 0) {
      unsigned char drain[512];
      (void)mbedtls_ssl_read(&cssl, drain, sizeof drain);
    }
    int cfatal = crc != 0 && crc != MBEDTLS_ERR_SSL_WANT_READ &&
                 crc != MBEDTLS_ERR_SSL_WANT_WRITE &&
                 crc != MBEDTLS_ERR_SSL_TIMEOUT;
    int sfatal = src != 0 && src != MBEDTLS_ERR_SSL_WANT_READ &&
                 src != MBEDTLS_ERR_SSL_WANT_WRITE &&
                 src != MBEDTLS_ERR_SSL_TIMEOUT;
    if (cfatal || sfatal) break;
    poll_sleep(5);
    elapsed += 5;
  }

  char d[128];
  snprintf(d, sizeof d, "client=%d server=%d in %dms", crc, src, elapsed);
  int ok = (crc == 0 && src == 0);
  ck("handshake completes over a real socket", ok, d);

  snprintf(d, sizeof d, "%u sent, %u dropped, %u reordered",
           imp.sent, imp.dropped, imp.reordered);
  /* Proving the impairment HAPPENED. A lossy test that silently dropped
   * nothing is the same false green as a probe whose statements never ran. */
  if (drop_pct > 0) ck("datagrams were actually dropped", imp.dropped > 0, d);
  else printf("       %s\n", d);
  if (reorder_pct > 0) ck("datagrams were actually reordered", imp.reordered > 0, d);

  if (ok) {
    const mbedtls_x509_crt *pc = mbedtls_ssl_get_peer_cert(&cssl);
    if (pc != NULL) {
      uint8_t got[32];
      scr_wrtc_fp_of_cert(pc->raw.p, pc->raw.len, got);
      ck("peer fingerprint authenticates", scr_wrtc_fp_equal(got, sfp), NULL);
      ck("and does not match the wrong certificate",
         !scr_wrtc_fp_equal(got, cfp), NULL);
    } else {
      ck("peer certificate present", 0, NULL);
    }

    /* Application data over the same impaired path. DTLS records are not
     * retransmitted, so under loss a write may simply not arrive -- the
     * write must SUCCEED and the read is retried within the budget. */
    static const unsigned char msg[] = "wa-web-call";
    unsigned char rx[128];
    int got_it = 0;
    for (int tries = 0; tries < 40 && !got_it; tries++) {
      mbedtls_ssl_write(&cssl, msg, sizeof msg - 1);
      for (int r = 0; r < 10 && !got_it; r++) {
        int n = mbedtls_ssl_read(&sssl, rx, sizeof rx);
        if (n == (int)(sizeof msg - 1) && memcmp(rx, msg, (size_t)n) == 0) got_it = 1;
        else poll_sleep(5);
      }
    }
    ck("application data arrives intact", got_it, NULL);
  }

  mbedtls_ssl_free(&cssl);
  mbedtls_ssl_free(&sssl);
  mbedtls_ssl_config_free(&cconf);
  mbedtls_ssl_config_free(&sconf);
  mbedtls_x509_crt_free(&cx);
  mbedtls_x509_crt_free(&sx);
  mbedtls_ctr_drbg_free(&drbg);
  mbedtls_entropy_free(&ent);
  scr_wrtc_cert_free(cc);
  scr_wrtc_cert_free(sc);
  closesocket(csock);
  closesocket(ssock);
  return ok;
}

int main(void) {
#ifdef _WIN32
  WSADATA wsa;
  WSAStartup(MAKEWORD(2, 2), &wsa);
#endif
  printf("DTLS 1.2 over REAL loopback UDP, with deliberate impairment\n");

  run_case("clean", 0, 0, 1u, 8000, 50, 4000);
  run_case("20% loss", 20, 0, 12345u, 20000, 50, 4000);
  /* The SAME loss pattern twice, differing only in the retransmission
   * ceiling. mbedtls's default-ish 4 s ceiling starves a lossy handshake:
   * the backoff doubles to 4 s and stays there, so 30 s buys about seven
   * more flights. A 400 ms ceiling is the right order for loopback and a
   * LAN relay, and is what zapo's path would use. */
  run_case("40% loss, 4000ms ceiling", 40, 0, 999u, 30000, 50, 4000);
  run_case("40% loss, 400ms ceiling", 40, 0, 999u, 30000, 50, 400);
  /* reorder_pct 100: with a clean handshake there are only a handful of
   * datagrams, and a 30% roll can legitimately never fire -- which the
   * "was actually reordered" check correctly caught as a non-test. */
  run_case("reordering", 0, 100, 4242u, 15000, 50, 400);
  run_case("30% loss + reordering", 30, 100, 777u, 30000, 50, 400);

  printf("\n%d checks, %d failures\nRESULT: %s\n", checks, fails,
         fails ? "FAIL" : "PASS");
#ifdef _WIN32
  WSACleanup();
#endif
  return fails ? 1 : 0;
}
