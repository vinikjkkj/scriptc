/* Does a DTLS 1.2 handshake actually COMPLETE with our certificate, and
 * does our fingerprint check authenticate the peer?
 *
 * Two real mbedtls endpoints, client and server, both presenting a
 * scr_wrtc_cert_generate() certificate, wired together by an in-memory
 * transport. No sockets: the point is to prove the crypto and the
 * authentication, and a loopback socket would only add a way for the test
 * to hang. Wiring to scr_dgram.c is the next step and is NOT done here.
 *
 * What this is evidence for: that the certificate this endpoint generates
 * is one a DTLS peer accepts, that DTLS 1.2 negotiates with it, that
 * application data flows both ways, and that the SDP fingerprint
 * comparison distinguishes the real peer from any other certificate.
 *
 * What it is NOT evidence for: retransmission, packet loss, reordering,
 * MTU behaviour, or anything a real network does. The transport here is
 * lossless and ordered by construction.
 */
#include <stdio.h>
#include <string.h>

#include "mbedtls/ctr_drbg.h"
#include "mbedtls/entropy.h"
#include "mbedtls/pk.h"
#include "mbedtls/ssl.h"
#include "mbedtls/x509_crt.h"

#include "scr_wrtc_cert.h"
#include "scr_wrtc_fp.h"

static int fails = 0, checks = 0;

static void ck(const char *what, bool ok, const char *detail) {
  checks++;
  if (ok) printf("  ok   %-52s %s\n", what, detail ? detail : "");
  else {
    printf("  FAIL %-52s %s\n", what, detail ? detail : "");
    fails++;
  }
}

/* in-memory transport: one queue per direction, non-blocking. An empty
 * queue answers WANT_READ, which is what a non-blocking UDP socket does
 * and what drives mbedtls's handshake state machine. */
#define QCAP 65536
typedef struct {
  unsigned char buf[QCAP];
  size_t head, tail;
} Queue;

typedef struct {
  Queue *out;
  Queue *in;
} Endpoint;

static int q_push(Queue *q, const unsigned char *d, size_t n) {
  if (q->tail + n > QCAP) return -1;
  memcpy(q->buf + q->tail, d, n);
  q->tail += n;
  return (int)n;
}

/* Datagram-preserving: DTLS needs record boundaries kept, so each send
 * carries a length prefix. A byte-stream transport here would look like a
 * working test and fail against a real socket. */
static int bio_send(void *ctx, const unsigned char *buf, size_t len) {
  Endpoint *e = ctx;
  unsigned char hdr[2];
  hdr[0] = (unsigned char)(len >> 8);
  hdr[1] = (unsigned char)len;
  if (q_push(e->out, hdr, 2) < 0) return MBEDTLS_ERR_SSL_WANT_WRITE;
  if (q_push(e->out, buf, len) < 0) return MBEDTLS_ERR_SSL_WANT_WRITE;
  return (int)len;
}

static int bio_recv(void *ctx, unsigned char *buf, size_t len) {
  Endpoint *e = ctx;
  Queue *q = e->in;
  if (q->tail - q->head < 2) return MBEDTLS_ERR_SSL_WANT_READ;
  size_t n = ((size_t)q->buf[q->head] << 8) | (size_t)q->buf[q->head + 1];
  if (q->tail - q->head < 2 + n) return MBEDTLS_ERR_SSL_WANT_READ;
  if (n > len) n = len;
  memcpy(buf, q->buf + q->head + 2, n);
  q->head += 2 + n;
  if (q->head == q->tail) {
    q->head = 0;
    q->tail = 0;
  }
  return (int)n;
}

/* DTLS requires a retransmission timer. This transport is lossless, so
 * nothing needs retransmitting and a never-expiring timer is correct here
 * rather than a stub -- but it is also exactly why this harness says
 * nothing about retransmission, which a real socket will exercise. */
static void timer_set(void *ctx, uint32_t inter, uint32_t fin) {
  (void)ctx;
  (void)inter;
  (void)fin;
}

static int timer_get(void *ctx) {
  (void)ctx;
  return 0;
}

int main(void) {
  printf("DTLS 1.2 handshake with our own certificate\n");

  ScrWrtcCert *cli_cert = scr_wrtc_cert_generate();
  ScrWrtcCert *srv_cert = scr_wrtc_cert_generate();
  ck("both endpoints have certificates", cli_cert != NULL && srv_cert != NULL, NULL);
  if (cli_cert == NULL || srv_cert == NULL) {
    printf("RESULT: FAIL\n");
    return 1;
  }

  /* Each side's advertised a=fingerprint value. */
  uint8_t cli_fp[32], srv_fp[32];
  scr_wrtc_cert_fingerprint(cli_cert, cli_fp);
  scr_wrtc_cert_fingerprint(srv_cert, srv_fp);

  size_t clen = 0, slen = 0;
  const uint8_t *cder = scr_wrtc_cert_der(cli_cert, &clen);
  const uint8_t *sder = scr_wrtc_cert_der(srv_cert, &slen);

  mbedtls_x509_crt cli_x509, srv_x509;
  mbedtls_x509_crt_init(&cli_x509);
  mbedtls_x509_crt_init(&srv_x509);
  ck("client cert parses for presentation",
     mbedtls_x509_crt_parse_der(&cli_x509, cder, clen) == 0, NULL);
  ck("server cert parses for presentation",
     mbedtls_x509_crt_parse_der(&srv_x509, sder, slen) == 0, NULL);

  Queue c2s, s2c;
  memset(&c2s, 0, sizeof c2s);
  memset(&s2c, 0, sizeof s2c);
  Endpoint cli_ep = { &c2s, &s2c };
  Endpoint srv_ep = { &s2c, &c2s };

  mbedtls_entropy_context ent;
  mbedtls_ctr_drbg_context drbg;
  mbedtls_entropy_init(&ent);
  mbedtls_ctr_drbg_init(&drbg);
  static const char pers[] = "scr-wrtc-dtls-test";
  ck("drbg seeds",
     mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &ent,
                           (const unsigned char *)pers, sizeof pers - 1) == 0,
     NULL);

  mbedtls_ssl_config cconf, sconf;
  mbedtls_ssl_context cssl, sssl;
  mbedtls_ssl_config_init(&cconf);
  mbedtls_ssl_config_init(&sconf);
  mbedtls_ssl_init(&cssl);
  mbedtls_ssl_init(&sssl);

  int rc = mbedtls_ssl_config_defaults(&cconf, MBEDTLS_SSL_IS_CLIENT,
                                       MBEDTLS_SSL_TRANSPORT_DATAGRAM,
                                       MBEDTLS_SSL_PRESET_DEFAULT);
  int rs = mbedtls_ssl_config_defaults(&sconf, MBEDTLS_SSL_IS_SERVER,
                                       MBEDTLS_SSL_TRANSPORT_DATAGRAM,
                                       MBEDTLS_SSL_PRESET_DEFAULT);
  ck("both configs default to DTLS", rc == 0 && rs == 0, NULL);

  mbedtls_ssl_conf_rng(&cconf, mbedtls_ctr_drbg_random, &drbg);
  mbedtls_ssl_conf_rng(&sconf, mbedtls_ctr_drbg_random, &drbg);

  /* WebRTC authenticates by FINGERPRINT, never by chain. VERIFY_NONE here
   * is the protocol, not a shortcut -- the check that replaces it runs
   * below, and it is the one that must not be skipped. */
  mbedtls_ssl_conf_authmode(&cconf, MBEDTLS_SSL_VERIFY_NONE);
  /* The server must REQUEST a client certificate; without this the client
   * never sends one and there is nothing for the server to fingerprint. */
  mbedtls_ssl_conf_authmode(&sconf, MBEDTLS_SSL_VERIFY_OPTIONAL);

  ck("client key and cert installed",
     mbedtls_ssl_conf_own_cert(&cconf, &cli_x509,
                               (mbedtls_pk_context *)scr_wrtc_cert_pk(cli_cert)) == 0,
     NULL);
  ck("server key and cert installed",
     mbedtls_ssl_conf_own_cert(&sconf, &srv_x509,
                               (mbedtls_pk_context *)scr_wrtc_cert_pk(srv_cert)) == 0,
     NULL);

  /* No HelloVerifyRequest: a WebRTC peer is already authenticated by ICE
   * before DTLS starts, so the anti-DoS cookie buys nothing. */
  mbedtls_ssl_conf_dtls_cookies(&sconf, NULL, NULL, NULL);

  ck("client setup", mbedtls_ssl_setup(&cssl, &cconf) == 0, NULL);
  ck("server setup", mbedtls_ssl_setup(&sssl, &sconf) == 0, NULL);

  int ctimer = 0, stimer = 0;
  mbedtls_ssl_set_timer_cb(&cssl, &ctimer, timer_set, timer_get);
  mbedtls_ssl_set_timer_cb(&sssl, &stimer, timer_set, timer_get);
  mbedtls_ssl_set_bio(&cssl, &cli_ep, bio_send, bio_recv, NULL);
  mbedtls_ssl_set_bio(&sssl, &srv_ep, bio_send, bio_recv, NULL);

  /* Drive both sides until both report done. BOUNDED: an unbounded loop
   * turns a handshake bug into a hung test rather than a failing one. */
  int crc = MBEDTLS_ERR_SSL_WANT_READ;
  int src = MBEDTLS_ERR_SSL_WANT_READ;
  int spins = 0;
  while ((crc != 0 || src != 0) && spins < 200) {
    spins++;
    if (crc != 0) crc = mbedtls_ssl_handshake(&cssl);
    if (src != 0) src = mbedtls_ssl_handshake(&sssl);
    if (crc != 0 && crc != MBEDTLS_ERR_SSL_WANT_READ &&
        crc != MBEDTLS_ERR_SSL_WANT_WRITE) break;
    if (src != 0 && src != MBEDTLS_ERR_SSL_WANT_READ &&
        src != MBEDTLS_ERR_SSL_WANT_WRITE) break;
  }
  char hs[96];
  snprintf(hs, sizeof hs, "client=%d server=%d spins=%d", crc, src, spins);
  ck("HANDSHAKE COMPLETES", crc == 0 && src == 0, hs);

  if (crc == 0 && src == 0) {
    printf("       %s / %s\n", mbedtls_ssl_get_version(&cssl),
           mbedtls_ssl_get_ciphersuite(&cssl));

    /* THE AUTHENTICATION STEP: hash the certificate that actually arrived
     * and compare it with what the SDP promised. */
    const mbedtls_x509_crt *by_client = mbedtls_ssl_get_peer_cert(&cssl);
    ck("client received a peer certificate", by_client != NULL, NULL);
    if (by_client != NULL) {
      uint8_t got[32];
      scr_wrtc_fp_of_cert(by_client->raw.p, by_client->raw.len, got);
      ck("it hashes to the SERVER's advertised fingerprint",
         scr_wrtc_fp_equal(got, srv_fp), NULL);
      /* A comparison that cannot fail proves nothing: check it does NOT
       * match the other certificate in play. */
      ck("and NOT to the client's own certificate",
         !scr_wrtc_fp_equal(got, cli_fp), NULL);
    }

    const mbedtls_x509_crt *by_server = mbedtls_ssl_get_peer_cert(&sssl);
    ck("server received a peer certificate", by_server != NULL, NULL);
    if (by_server != NULL) {
      uint8_t got[32];
      scr_wrtc_fp_of_cert(by_server->raw.p, by_server->raw.len, got);
      ck("it hashes to the CLIENT's advertised fingerprint",
         scr_wrtc_fp_equal(got, cli_fp), NULL);
    }

    /* Application data both ways -- the channel SCTP will ride. */
    static const unsigned char msg[] = "wa-web-call";
    int wn = mbedtls_ssl_write(&cssl, msg, sizeof msg - 1);
    ck("client writes application data", wn == (int)(sizeof msg - 1), NULL);
    unsigned char rx[64];
    int n = mbedtls_ssl_read(&sssl, rx, sizeof rx);
    ck("server reads exactly those bytes",
       n == (int)(sizeof msg - 1) && memcmp(rx, msg, (size_t)n) == 0, NULL);

    static const unsigned char back[] = "ack";
    wn = mbedtls_ssl_write(&sssl, back, sizeof back - 1);
    ck("server writes back", wn == (int)(sizeof back - 1), NULL);
    n = mbedtls_ssl_read(&cssl, rx, sizeof rx);
    ck("client reads it",
       n == (int)(sizeof back - 1) && memcmp(rx, back, (size_t)n) == 0, NULL);
  }

  mbedtls_ssl_free(&cssl);
  mbedtls_ssl_free(&sssl);
  mbedtls_ssl_config_free(&cconf);
  mbedtls_ssl_config_free(&sconf);
  mbedtls_x509_crt_free(&cli_x509);
  mbedtls_x509_crt_free(&srv_x509);
  mbedtls_ctr_drbg_free(&drbg);
  mbedtls_entropy_free(&ent);
  scr_wrtc_cert_free(cli_cert);
  scr_wrtc_cert_free(srv_cert);

  printf("\n%d checks, %d failures\nRESULT: %s\n", checks, fails,
         fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
