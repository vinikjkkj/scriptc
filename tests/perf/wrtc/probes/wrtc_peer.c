/* wrtc_peer.c — a standalone relay for the end-to-end probe.
 *
 * WHY A SEPARATE PROCESS. Everything else in this clause drives the
 * transport from a C test that also owns the client. This one exists so
 * the client can be a COMPILED SCRIPTC BINARY produced from TypeScript --
 * the only way to show that the pump really is runtime code owned by the
 * event loop, rather than a harness that happens to link the same files.
 *
 * It binds 127.0.0.1:<port>, prints its certificate fingerprint on stdout
 * so the driver can write it into the answer SDP, then speaks DTLS 1.2 as
 * the SERVER and runs the same hand-written scripted SCTP peer the other
 * probes use. On the first user message it replies once.
 *
 * WHAT THIS IS NOT: a WebRTC endpoint. It does not speak STUN, it does no
 * ICE, and it is code in this repository. A scriptc binary talking to it
 * proves the stack runs end to end under the event loop; it proves
 * nothing about interoperating with a browser or with WhatsApp's relay.
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

/* The scripted SCTP peer needs ck() for the assertions it does not use
 * here; one stub keeps sctp_peer.inc a single shared source. */
static int fails = 0, checks = 0;
static void ck(const char *what, int ok, const char *detail) {
  (void)what; (void)detail;
  checks++;
  if (!ok) fails++;
}
#include "sctp_peer.inc"

typedef struct {
  SOCKET sock;
  struct sockaddr_in peer;
  bool have_peer;
} Io;

static int io_send(void *ctx, const unsigned char *buf, size_t len) {
  Io *t = ctx;
  if (!t->have_peer) return MBEDTLS_ERR_SSL_WANT_WRITE;
  sendto(t->sock, (const char *)buf, (int)len, 0,
         (struct sockaddr *)&t->peer, sizeof t->peer);
  return (int)len;
}

static int io_recv(void *ctx, unsigned char *buf, size_t len) {
  Io *t = ctx;
  struct sockaddr_in from;
  socklen_t flen = sizeof from;
  int n = recvfrom(t->sock, (char *)buf, (int)len, 0,
                   (struct sockaddr *)&from, &flen);
  if (n < 0) return MBEDTLS_ERR_SSL_WANT_READ;
  /* The offerer's host candidate is not in the answer, so the relay
   * learns the client's address from its first datagram -- which is what
   * a real relay does. */
  t->peer = from;
  t->have_peer = true;
  return n;
}

int main(int argc, char **argv) {
  unsigned port = argc > 1 ? (unsigned)atoi(argv[1]) : 34801u;
  int budget_ms = argc > 2 ? atoi(argv[2]) : 20000;
#ifdef _WIN32
  WSADATA wsa;
  WSAStartup(MAKEWORD(2, 2), &wsa);
#endif
  mbedtls_entropy_context ent;
  mbedtls_ctr_drbg_context drbg;
  mbedtls_entropy_init(&ent);
  mbedtls_ctr_drbg_init(&drbg);
  static const char pers[] = "scr-wrtc-peer";
  if (mbedtls_ctr_drbg_seed(&drbg, mbedtls_entropy_func, &ent,
                            (const unsigned char *)pers, sizeof pers - 1) != 0) {
    printf("PEER-ERROR drbg\n");
    return 1;
  }
  ScrWrtcCert *cert = scr_wrtc_cert_generate();
  if (cert == NULL) {
    printf("PEER-ERROR cert\n");
    return 1;
  }
  uint8_t fp[32];
  char fp_text[96];
  scr_wrtc_cert_fingerprint(cert, fp);
  scr_wrtc_fp_format(fp, fp_text);

  Io io;
  memset(&io, 0, sizeof io);
  io.sock = socket(AF_INET, SOCK_DGRAM, 0);
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  a.sin_port = htons((unsigned short)port);
  if (io.sock == INVALID_SOCKET || bind(io.sock, (struct sockaddr *)&a, sizeof a) != 0) {
    printf("PEER-ERROR bind %u\n", port);
    return 1;
  }
#ifdef _WIN32
  u_long nb = 1;
  ioctlsocket(io.sock, FIONBIO, &nb);
#else
  fcntl(io.sock, F_SETFL, O_NONBLOCK);
#endif

  size_t dl = 0;
  const uint8_t *der = scr_wrtc_cert_der(cert, &dl);
  mbedtls_x509_crt crt;
  mbedtls_ssl_config conf;
  mbedtls_ssl_context ssl;
  mbedtls_timing_delay_context timer;
  mbedtls_x509_crt_init(&crt);
  mbedtls_ssl_config_init(&conf);
  mbedtls_ssl_init(&ssl);
  if (mbedtls_x509_crt_parse_der(&crt, der, dl) != 0 ||
      mbedtls_ssl_config_defaults(&conf, MBEDTLS_SSL_IS_SERVER,
                                  MBEDTLS_SSL_TRANSPORT_DATAGRAM,
                                  MBEDTLS_SSL_PRESET_DEFAULT) != 0) {
    printf("PEER-ERROR tls-config\n");
    return 1;
  }
  mbedtls_ssl_conf_rng(&conf, mbedtls_ctr_drbg_random, &drbg);
  mbedtls_ssl_conf_authmode(&conf, MBEDTLS_SSL_VERIFY_NONE);
  mbedtls_ssl_conf_own_cert(&conf, &crt, (mbedtls_pk_context *)scr_wrtc_cert_pk(cert));
  mbedtls_ssl_conf_dtls_cookies(&conf, NULL, NULL, NULL);
  mbedtls_ssl_conf_handshake_timeout(&conf, 50, 4000);
  if (mbedtls_ssl_setup(&ssl, &conf) != 0) {
    printf("PEER-ERROR ssl-setup\n");
    return 1;
  }
  mbedtls_ssl_set_timer_cb(&ssl, &timer, mbedtls_timing_set_delay,
                           mbedtls_timing_get_delay);
  mbedtls_ssl_set_bio(&ssl, &io, io_send, io_recv, NULL);

  /* The driver reads this line and writes it into the answer SDP, so the
   * fingerprint the client authenticates against is this certificate and
   * no other. */
  printf("PEER-READY %u %s\n", port, fp_text);
  fflush(stdout);

  Peer p;
  memset(&p, 0, sizeof p);
  p.local_port = 5000;
  p.remote_port = 5000;
  p.my_tag = 0x1234ABCDu;
  p.next_tsn = 900u;

  int hs = MBEDTLS_ERR_SSL_WANT_READ;
  bool replied = false;
  uint8_t rx[2048];
  uint64_t t0 = now_ms();
  while ((int)(now_ms() - t0) < budget_ms) {
    uint64_t t = now_ms();
    if (hs != 0) {
      hs = mbedtls_ssl_handshake(&ssl);
      if (hs == 0) {
        printf("PEER-DTLS-UP\n");
        fflush(stdout);
      } else if (hs != MBEDTLS_ERR_SSL_WANT_READ && hs != MBEDTLS_ERR_SSL_WANT_WRITE) {
        printf("PEER-DTLS-FAILED %d\n", hs);
        fflush(stdout);
        break;
      }
      poll_sleep(1);
      continue;
    }
    for (;;) {
      int r = mbedtls_ssl_read(&ssl, rx, sizeof rx);
      if (r <= 0) break;
      peer_input(&p, rx, (size_t)r);
      for (int g = 0; g < 4; g++) {
        if (p.out_len > 0) {
          mbedtls_ssl_write(&ssl, p.out, p.out_len);
          p.out_len = 0;
        } else if (p.pending_dcep_ack) {
          uint8_t ack[1] = { SCR_SCTP_DCEP_DATA_CHANNEL_ACK };
          peer_send_data(&p, SCR_SCTP_PPID_DCEP, ack, 1);
          p.pending_dcep_ack = false;
          mbedtls_ssl_write(&ssl, p.out, p.out_len);
          p.out_len = 0;
        } else break;
      }
    }
    peer_tick(&p, t);
    if (p.out_len > 0) {
      mbedtls_ssl_write(&ssl, p.out, p.out_len);
      p.out_len = 0;
    }
    if (p.got_dcep_open && !replied && p.data_from_client >= 1) {
      static const uint8_t reply[] = "relay-pong";
      peer_send_data(&p, SCR_SCTP_PPID_BINARY, reply, sizeof reply - 1);
      mbedtls_ssl_write(&ssl, p.out, p.out_len);
      p.out_len = 0;
      replied = true;
      printf("PEER-REPLIED\n");
      fflush(stdout);
    }
    poll_sleep(1);
  }
  printf("PEER-DONE dcep=%d from-client=%u replied=%d\n",
         p.got_dcep_open ? 1 : 0, p.data_from_client, replied ? 1 : 0);
  fflush(stdout);
  mbedtls_ssl_free(&ssl);
  mbedtls_ssl_config_free(&conf);
  mbedtls_x509_crt_free(&crt);
  scr_wrtc_cert_free(cert);
  mbedtls_ctr_drbg_free(&drbg);
  mbedtls_entropy_free(&ent);
  closesocket(io.sock);
  (void)checks;
  (void)fails;
  return 0;
}
