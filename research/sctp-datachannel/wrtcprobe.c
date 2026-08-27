/* wrtcprobe.c — a scoping prototype, NOT runtime code.
 *
 * Answers one question with a compiled artefact instead of an argument:
 * can ICE + DTLS + SCTP + DCEP, built from (a) hand-written C, (b) the
 * mbedTLS already vendored in packages/runtime/vendor/mbedtls, and (c) a
 * vendored usrsctp, establish a WebRTC data channel against the real
 * @roamhq/wrtc under Node and exchange bytes?
 *
 * Shape: this peer is the ANSWERER. Node offers (a=setup:actpass, ICE
 * controlling); we answer a=setup:active, so WE are the DTLS client and the
 * ICE controlled agent. DTLS-client is the role zapo's WaSctpRelay needs
 * (it forces a=setup:passive into the answer it fabricates).
 *
 * Signaling is stdin/stdout: read the offer SDP between OFFER-BEGIN /
 * OFFER-END, write the answer between ANSWER-BEGIN / ANSWER-END.
 */

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <fcntl.h>
#include <io.h>

#include "mbedtls/build_info.h"
#include "mbedtls/ssl.h"
#include "mbedtls/entropy.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/x509_crt.h"
#include "mbedtls/x509_csr.h"
#include "mbedtls/pk.h"
#include "mbedtls/ecp.h"
#include "mbedtls/md.h"
#include "mbedtls/sha256.h"
#include "mbedtls/timing.h"
#include "mbedtls/error.h"

#include "usrsctp.h"

#define LOGF(...) do { fprintf(stderr, "[probe] " __VA_ARGS__); fputc('\n', stderr); fflush(stderr); } while (0)

static void die(const char *what, int rc) {
  char buf[256];
  if (rc) {
    mbedtls_strerror(rc, buf, sizeof buf);
    fprintf(stderr, "[probe] FATAL %s: -0x%04x %s\n", what, (unsigned)-rc, buf);
  } else {
    fprintf(stderr, "[probe] FATAL %s\n", what);
  }
  fflush(stderr);
  exit(3);
}

/* ── STUN ────────────────────────────────────────────────────────────── */

#define STUN_COOKIE      0x2112A442u
#define STUN_BINDING_REQ 0x0001
#define STUN_BINDING_RSP 0x0101
#define A_USERNAME       0x0006
#define A_MESSAGE_INTEG  0x0008
#define A_XOR_MAPPED     0x0020
#define A_PRIORITY       0x0024
#define A_USE_CANDIDATE  0x0025
#define A_FINGERPRINT    0x8028
#define A_ICE_CONTROLLED 0x8029
#define A_ICE_CONTROLLING 0x802A

static uint32_t crc32_of(const uint8_t *p, size_t n) {
  static uint32_t tbl[256];
  static int init = 0;
  if (!init) {
    for (uint32_t i = 0; i < 256; i++) {
      uint32_t c = i;
      for (int k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
      tbl[i] = c;
    }
    init = 1;
  }
  uint32_t c = 0xFFFFFFFFu;
  for (size_t i = 0; i < n; i++) c = tbl[(c ^ p[i]) & 0xFF] ^ (c >> 8);
  return c ^ 0xFFFFFFFFu;
}

static void put16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)(v >> 8); p[1] = (uint8_t)v; }
static void put32(uint8_t *p, uint32_t v) { p[0]=(uint8_t)(v>>24); p[1]=(uint8_t)(v>>16); p[2]=(uint8_t)(v>>8); p[3]=(uint8_t)v; }
static uint16_t get16(const uint8_t *p) { return (uint16_t)((p[0] << 8) | p[1]); }
static uint32_t get32(const uint8_t *p) { return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3]; }

typedef struct { uint8_t b[1500]; size_t n; } msg_t;

static void stun_begin(msg_t *m, uint16_t type, const uint8_t txid[12]) {
  memset(m, 0, sizeof *m);
  put16(m->b, type);
  put16(m->b + 2, 0);
  put32(m->b + 4, STUN_COOKIE);
  memcpy(m->b + 8, txid, 12);
  m->n = 20;
}

static void stun_attr(msg_t *m, uint16_t type, const void *val, size_t len) {
  put16(m->b + m->n, type);
  put16(m->b + m->n + 2, (uint16_t)len);
  memcpy(m->b + m->n + 4, val, len);
  size_t pad = (4 - (len % 4)) % 4;
  memset(m->b + m->n + 4 + len, 0, pad);
  m->n += 4 + len + pad;
}

/* MESSAGE-INTEGRITY is HMAC-SHA1 over the message with the length field
 * already advanced to cover the 24-byte MI attribute itself. */
static void stun_add_integrity(msg_t *m, const char *key) {
  put16(m->b + 2, (uint16_t)(m->n - 20 + 24));
  uint8_t mac[20];
  const mbedtls_md_info_t *md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA1);
  if (mbedtls_md_hmac(md, (const uint8_t *)key, strlen(key), m->b, m->n, mac) != 0) die("hmac", 0);
  stun_attr(m, A_MESSAGE_INTEG, mac, 20);
}

static void stun_add_fingerprint(msg_t *m) {
  put16(m->b + 2, (uint16_t)(m->n - 20 + 8));
  uint32_t fp = crc32_of(m->b, m->n) ^ 0x5354554Eu;
  uint8_t v[4];
  put32(v, fp);
  stun_attr(m, A_FINGERPRINT, v, 4);
}

static void stun_finish(msg_t *m) { put16(m->b + 2, (uint16_t)(m->n - 20)); }

static int stun_find(const uint8_t *b, size_t n, uint16_t want, const uint8_t **out, size_t *outlen) {
  if (n < 20) return 0;
  size_t off = 20, end = 20 + get16(b + 2);
  if (end > n) end = n;
  while (off + 4 <= end) {
    uint16_t t = get16(b + off), l = get16(b + off + 2);
    if (off + 4 + l > end) return 0;
    if (t == want) { *out = b + off + 4; *outlen = l; return 1; }
    off += 4 + l + ((4 - (l % 4)) % 4);
  }
  return 0;
}

/* ── SDP ─────────────────────────────────────────────────────────────── */

static int sdp_value(const char *sdp, const char *key, char *out, size_t outsz) {
  const char *p = sdp;
  size_t klen = strlen(key);
  while (*p) {
    if (strncmp(p, key, klen) == 0 && (p == sdp || p[-1] == '\n')) {
      const char *q = p + klen;
      const char *e = q;
      while (*e && *e != '\r' && *e != '\n') e++;
      size_t len = (size_t)(e - q);
      if (len >= outsz) len = outsz - 1;
      memcpy(out, q, len);
      out[len] = 0;
      return 1;
    }
    p++;
  }
  return 0;
}

/* ── global state ────────────────────────────────────────────────────── */

typedef struct {
  SOCKET sock;
  struct sockaddr_in peer;
  int peer_known;

  char l_ufrag[64], l_pwd[128];
  char r_ufrag[64], r_pwd[128];
  char r_fingerprint[128];      /* "sha-256 AA:BB:.." as it appeared */
  uint8_t r_fp_bytes[32];
  int r_fp_len;

  int ice_ready;
  int binding_responses;
  int dtls_ready;

  mbedtls_ssl_context ssl;
  mbedtls_ssl_config conf;
  mbedtls_entropy_context entropy;
  mbedtls_ctr_drbg_context drbg;
  mbedtls_x509_crt own_cert;
  mbedtls_pk_context own_key;
  mbedtls_timing_delay_context timer;

  struct socket *sctp;
  int sctp_up;
  int dcep_acked;
  int got_echo;
  int echo_len;
  uint8_t echo[512];
} probe_t;

static probe_t P;

/* ── UDP + demux ─────────────────────────────────────────────────────── */

static void udp_send(const void *b, size_t n) {
  if (!P.peer_known) return;
  sendto(P.sock, (const char *)b, (int)n, 0, (struct sockaddr *)&P.peer, sizeof P.peer);
}

/* mbedTLS BIO: DTLS records ride the same UDP socket ICE uses. Inbound
 * demux happens in the main loop (RFC 7983 first-byte rule), which parks
 * one record here for the BIO to hand to mbedTLS. */
static uint8_t bio_buf[4096];
static size_t bio_len = 0;

static int bio_send(void *ctx, const unsigned char *b, size_t n) {
  (void)ctx;
  udp_send(b, n);
  return (int)n;
}

static int bio_recv(void *ctx, unsigned char *b, size_t n) {
  (void)ctx;
  if (bio_len == 0) return MBEDTLS_ERR_SSL_WANT_READ;
  size_t k = bio_len < n ? bio_len : n;
  memcpy(b, bio_buf, k);
  bio_len = 0;
  return (int)k;
}

/* ── usrsctp glue ────────────────────────────────────────────────────── */

static int conn_output(void *addr, void *buf, size_t len, uint8_t tos, uint8_t sf) {
  (void)addr; (void)tos; (void)sf;
  if (!P.dtls_ready) return 0;
  int rc = mbedtls_ssl_write(&P.ssl, (const unsigned char *)buf, len);
  if (rc < 0) { LOGF("ssl_write rc=-0x%04x", (unsigned)-rc); return -1; }
  return 0;
}

#define PPID_DCEP    50
#define PPID_BINARY  53
#define DC_OPEN      0x03
#define DC_ACK       0x02
#define DC_RELIABLE_UNORDERED 0x80

static void sctp_send(uint16_t sid, uint32_t ppid, int unordered, const void *b, size_t n) {
  struct sctp_sendv_spa spa;
  memset(&spa, 0, sizeof spa);
  spa.sendv_flags = SCTP_SEND_SNDINFO_VALID;
  spa.sendv_sndinfo.snd_sid = sid;
  spa.sendv_sndinfo.snd_ppid = htonl(ppid);
  spa.sendv_sndinfo.snd_flags = (uint16_t)(unordered ? SCTP_UNORDERED : 0);
  ssize_t rc = usrsctp_sendv(P.sctp, b, n, NULL, 0, &spa, (socklen_t)sizeof spa, SCTP_SENDV_SPA, 0);
  if (rc < 0) LOGF("usrsctp_sendv failed");
}

static void send_dcep_open(void) {
  const char *label = "wa-web-call";
  uint8_t m[128];
  size_t lp = strlen(label);
  m[0] = DC_OPEN;
  m[1] = DC_RELIABLE_UNORDERED;   /* zapo: createDataChannel(..., {ordered:false}) */
  put16(m + 2, 0);                /* priority */
  put32(m + 4, 0);                /* reliability parameter */
  put16(m + 8, (uint16_t)lp);     /* label length */
  put16(m + 10, 0);               /* protocol length */
  memcpy(m + 12, label, lp);
  LOGF("-> DCEP DATA_CHANNEL_OPEN stream=0 label=%s", label);
  sctp_send(0, PPID_DCEP, 0, m, 12 + lp);
}

static int sctp_recv_cb(struct socket *s, union sctp_sockstore addr, void *data,
                        size_t datalen, struct sctp_rcvinfo rcv, int flags, void *ulp) {
  (void)s; (void)addr; (void)ulp;
  if (data == NULL) return 1;
  if (flags & MSG_NOTIFICATION) {
    union sctp_notification *n = (union sctp_notification *)data;
    if (n->sn_header.sn_type == SCTP_ASSOC_CHANGE) {
      uint16_t st = n->sn_assoc_change.sac_state;
      LOGF("SCTP_ASSOC_CHANGE state=%u", (unsigned)st);
      if (st == SCTP_COMM_UP) { P.sctp_up = 1; }
      if (st == SCTP_COMM_LOST || st == SCTP_SHUTDOWN_COMP) P.sctp_up = -1;
    }
    free(data);
    return 1;
  }
  uint32_t ppid = ntohl(rcv.rcv_ppid);
  const uint8_t *b = (const uint8_t *)data;
  if (ppid == PPID_DCEP && datalen >= 1 && b[0] == DC_ACK) {
    LOGF("<- DCEP DATA_CHANNEL_ACK stream=%u", (unsigned)rcv.rcv_sid);
    P.dcep_acked = 1;
  } else if (ppid == PPID_BINARY || ppid == 51) {
    P.echo_len = (int)(datalen > sizeof P.echo ? sizeof P.echo : datalen);
    memcpy(P.echo, b, (size_t)P.echo_len);
    P.got_echo = 1;
    LOGF("<- SCTP data ppid=%u stream=%u len=%u", ppid, (unsigned)rcv.rcv_sid, (unsigned)datalen);
  } else {
    LOGF("<- SCTP data ppid=%u len=%u (ignored)", ppid, (unsigned)datalen);
  }
  free(data);
  return 1;
}

/* ── main ────────────────────────────────────────────────────────────── */

static const char B64URLISH[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static void rand_str(char *out, size_t n) {
  uint8_t r[64];
  mbedtls_ctr_drbg_random(&P.drbg, r, n);
  for (size_t i = 0; i < n; i++) out[i] = B64URLISH[r[i] & 63];
  out[n] = 0;
}

static int hexval(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static void fp_hex(const uint8_t *b, size_t n, char *out) {
  char *w = out;
  for (size_t i = 0; i < n; i++) {
    if (i) *w++ = ':';
    static const char H[] = "0123456789ABCDEF";
    *w++ = H[b[i] >> 4];
    *w++ = H[b[i] & 15];
  }
  *w = 0;
}

int main(int argc, char **argv) {
  (void)argc; (void)argv;
  /* Windows text mode would turn each "
" we print into "
" and
   * libwebrtc's SDP parser rejects the trailing CR ("Failed to create
   * fingerprint from the digest"). Binary mode keeps the CRLF exact. */
  _setmode(_fileno(stdout), _O_BINARY);
  setvbuf(stdout, NULL, _IONBF, 0);

  WSADATA wsa;
  if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) die("WSAStartup", 0);

  memset(&P, 0, sizeof P);

  mbedtls_entropy_init(&P.entropy);
  mbedtls_ctr_drbg_init(&P.drbg);
  const char *pers = "wrtcprobe";
  int rc = mbedtls_ctr_drbg_seed(&P.drbg, mbedtls_entropy_func, &P.entropy,
                                 (const unsigned char *)pers, strlen(pers));
  if (rc) die("ctr_drbg_seed", rc);

  /* ---- self-signed ECDSA P-256 certificate, the WebRTC identity ---- */
  mbedtls_pk_init(&P.own_key);
  rc = mbedtls_pk_setup(&P.own_key, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY));
  if (rc) die("pk_setup", rc);
  rc = mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(P.own_key),
                           mbedtls_ctr_drbg_random, &P.drbg);
  if (rc) die("ecp_gen_key", rc);

  mbedtls_x509write_cert wc;
  mbedtls_x509write_crt_init(&wc);
  mbedtls_x509write_crt_set_subject_key(&wc, &P.own_key);
  mbedtls_x509write_crt_set_issuer_key(&wc, &P.own_key);
  mbedtls_x509write_crt_set_subject_name(&wc, "CN=WebRTC");
  mbedtls_x509write_crt_set_issuer_name(&wc, "CN=WebRTC");
  mbedtls_x509write_crt_set_version(&wc, MBEDTLS_X509_CRT_VERSION_3);
  mbedtls_x509write_crt_set_md_alg(&wc, MBEDTLS_MD_SHA256);
  {
    mbedtls_mpi serial;
    mbedtls_mpi_init(&serial);
    mbedtls_mpi_lset(&serial, 1);
    mbedtls_x509write_crt_set_serial(&wc, &serial);
    mbedtls_mpi_free(&serial);
  }
  mbedtls_x509write_crt_set_validity(&wc, "20240101000000", "20340101000000");
  mbedtls_x509write_crt_set_basic_constraints(&wc, 0, -1);

  unsigned char der[4096];
  int derlen = mbedtls_x509write_crt_der(&wc, der, sizeof der, mbedtls_ctr_drbg_random, &P.drbg);
  if (derlen < 0) die("x509write_crt_der", derlen);
  unsigned char *derp = der + sizeof der - derlen;
  mbedtls_x509write_crt_free(&wc);

  mbedtls_x509_crt_init(&P.own_cert);
  rc = mbedtls_x509_crt_parse_der(&P.own_cert, derp, (size_t)derlen);
  if (rc) die("crt_parse_der", rc);

  uint8_t own_fp[32];
  mbedtls_sha256(derp, (size_t)derlen, own_fp, 0);
  char own_fp_str[128];
  fp_hex(own_fp, 32, own_fp_str);

  /* ---- ICE credentials + UDP socket ---- */
  rand_str(P.l_ufrag, 4);
  rand_str(P.l_pwd, 24);

  P.sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (P.sock == INVALID_SOCKET) die("socket", 0);
  struct sockaddr_in la;
  memset(&la, 0, sizeof la);
  la.sin_family = AF_INET;
  la.sin_addr.s_addr = htonl(INADDR_ANY);
  la.sin_port = 0;
  if (bind(P.sock, (struct sockaddr *)&la, sizeof la) != 0) die("bind", 0);
  int lalen = sizeof la;
  getsockname(P.sock, (struct sockaddr *)&la, &lalen);
  int lport = ntohs(la.sin_port);
  u_long nb = 1;
  ioctlsocket(P.sock, FIONBIO, &nb);
  LOGF("udp bound 127.0.0.1:%d  ufrag=%s", lport, P.l_ufrag);
  LOGF("own cert fingerprint sha-256 %s", own_fp_str);

  /* ---- read the offer ---- */
  char offer[16384];
  size_t olen = 0;
  {
    char line[1024];
    int in = 0;
    while (fgets(line, sizeof line, stdin)) {
      if (strncmp(line, "OFFER-BEGIN", 11) == 0) { in = 1; continue; }
      if (strncmp(line, "OFFER-END", 9) == 0) break;
      if (in) {
        size_t n = strlen(line);
        if (olen + n < sizeof offer) { memcpy(offer + olen, line, n); olen += n; }
      }
    }
    offer[olen] = 0;
  }
  if (olen == 0) die("no offer on stdin", 0);

  if (!sdp_value(offer, "a=ice-ufrag:", P.r_ufrag, sizeof P.r_ufrag)) die("offer has no ice-ufrag", 0);
  if (!sdp_value(offer, "a=ice-pwd:", P.r_pwd, sizeof P.r_pwd)) die("offer has no ice-pwd", 0);
  /* NEGATIVE CONTROL 1 for the ICE leg: sign our binding REQUESTS with a
   * key the peer did not publish. It must answer none of them, which shows
   * up as binding_responses == 0 at exit. (Inbound requests from the peer
   * still prove the path, so the run can still complete — that is correct
   * ICE, and the counter is what discriminates.) */
  if (getenv("PROBE_CORRUPT_ICEPWD")) {
    P.r_pwd[0] = (char)(P.r_pwd[0] == 'A' ? 'B' : 'A');
    LOGF("NEGATIVE CONTROL: signing ICE requests with a wrong key; expect binding_responses=0");
  }
  if (!sdp_value(offer, "a=fingerprint:", P.r_fingerprint, sizeof P.r_fingerprint)) die("offer has no fingerprint", 0);
  LOGF("offer ufrag=%s fingerprint=%s", P.r_ufrag, P.r_fingerprint);

  /* parse "sha-256 AA:BB:.." into bytes */
  {
    const char *h = strchr(P.r_fingerprint, ' ');
    if (!h) die("fingerprint has no algorithm separator", 0);
    if (strncmp(P.r_fingerprint, "sha-256", 7) != 0) die("fingerprint is not sha-256", 0);
    h++;
    P.r_fp_len = 0;
    while (*h && P.r_fp_len < 32) {
      int hi = hexval(h[0]), lo = hexval(h[1]);
      if (hi < 0 || lo < 0) break;
      P.r_fp_bytes[P.r_fp_len++] = (uint8_t)((hi << 4) | lo);
      h += 2;
      if (*h == ':') h++;
    }
    if (P.r_fp_len != 32) die("fingerprint is not 32 bytes", 0);
    /* NEGATIVE CONTROL. A fingerprint check that is never seen to fail is
     * not evidence that it works. With PROBE_CORRUPT_FP=1 we flip one bit
     * of the fingerprint the signaling channel carried; the handshake must
     * then be REFUSED. If it still completes, this whole stack is unsafe
     * and the run is a failure, not a success. */
    if (getenv("PROBE_CORRUPT_FP")) {
      P.r_fp_bytes[31] ^= 0x01;
      LOGF("NEGATIVE CONTROL: last fingerprint byte flipped; handshake MUST be refused");
    }
  }

  /* remote candidate: first a=candidate with typ host / any type, udp */
  {
    const char *p = offer;
    while ((p = strstr(p, "a=candidate:")) != NULL) {
      char foundation[64], transport[16], ip[64];
      int comp, prio, port;
      if (sscanf(p, "a=candidate:%63s %d %15s %d %63s %d",
                 foundation, &comp, transport, &prio, ip, &port) == 6) {
        if (comp == 1 && (transport[0] == 'u' || transport[0] == 'U')) {
          struct in_addr ia;
          int loop = (strcmp(ip, "127.0.0.1") == 0);
          if (inet_pton(AF_INET, ip, &ia) == 1 && (!P.peer_known || loop)) {
            memset(&P.peer, 0, sizeof P.peer);
            P.peer.sin_family = AF_INET;
            P.peer.sin_addr = ia;
            P.peer.sin_port = htons((uint16_t)port);
            P.peer_known = 1;
            LOGF("remote candidate %s:%d%s", ip, port, loop ? " (loopback, preferred)" : "");
            if (loop) break;
          }
        }
      }
      p += 12;
    }
  }
  if (!P.peer_known) die("offer had no usable udp candidate", 0);

  /* ---- emit the answer ---- */
  printf("ANSWER-BEGIN\n");
  printf("v=0\r\n");
  printf("o=- 4611686018427387904 2 IN IP4 127.0.0.1\r\n");
  printf("s=-\r\n");
  printf("t=0 0\r\n");
  printf("a=group:BUNDLE 0\r\n");
  printf("a=msid-semantic: WMS\r\n");
  printf("m=application %d UDP/DTLS/SCTP webrtc-datachannel\r\n", lport);
  printf("c=IN IP4 127.0.0.1\r\n");
  printf("a=ice-ufrag:%s\r\n", P.l_ufrag);
  printf("a=ice-pwd:%s\r\n", P.l_pwd);
  printf("a=fingerprint:sha-256 %s\r\n", own_fp_str);
  printf("a=setup:active\r\n");
  printf("a=mid:0\r\n");
  printf("a=sctp-port:5000\r\n");
  printf("a=max-message-size:262144\r\n");
  printf("a=candidate:1 1 udp 2130706431 127.0.0.1 %d typ host generation 0\r\n", lport);
  printf("a=end-of-candidates\r\n");
  printf("ANSWER-END\n");
  fflush(stdout);

  /* NEGATIVE CONTROL 2 for the ICE leg. We advertised l_pwd in the answer
   * we just printed; from here we sign our binding RESPONSES with a
   * different key. The peer must then never accept this path, so it must
   * never reach connected and DTLS must never carry data. */
  if (getenv("PROBE_CORRUPT_LOCAL_ICEPWD")) {
    P.l_pwd[0] = (char)(P.l_pwd[0] == 'A' ? 'B' : 'A');
    LOGF("NEGATIVE CONTROL: signing ICE responses with a key we did not advertise");
  }

  /* ---- DTLS setup (client) ---- */
  mbedtls_ssl_init(&P.ssl);
  mbedtls_ssl_config_init(&P.conf);
  rc = mbedtls_ssl_config_defaults(&P.conf, MBEDTLS_SSL_IS_CLIENT,
                                   MBEDTLS_SSL_TRANSPORT_DATAGRAM,
                                   MBEDTLS_SSL_PRESET_DEFAULT);
  if (rc) die("ssl_config_defaults", rc);
  /* DTLS 1.2 only — mbedTLS 3.6 has no DTLS 1.3, and libwebrtc offers 1.2. */
  mbedtls_ssl_conf_min_tls_version(&P.conf, MBEDTLS_SSL_VERSION_TLS1_2);
  mbedtls_ssl_conf_max_tls_version(&P.conf, MBEDTLS_SSL_VERSION_TLS1_2);
  /* The peer is self-signed by design: WebRTC binds identity to the SDP
   * fingerprint, not to a CA chain. OPTIONAL keeps the chain result out of
   * the way; the fingerprint check below is the real gate and it is NOT
   * optional. */
  mbedtls_ssl_conf_authmode(&P.conf, MBEDTLS_SSL_VERIFY_OPTIONAL);
  mbedtls_ssl_conf_rng(&P.conf, mbedtls_ctr_drbg_random, &P.drbg);
  rc = mbedtls_ssl_conf_own_cert(&P.conf, &P.own_cert, &P.own_key);
  if (rc) die("conf_own_cert", rc);
  rc = mbedtls_ssl_setup(&P.ssl, &P.conf);
  if (rc) die("ssl_setup", rc);
  mbedtls_ssl_set_bio(&P.ssl, NULL, bio_send, bio_recv, NULL);
  mbedtls_ssl_set_timer_cb(&P.ssl, &P.timer, mbedtls_timing_set_delay, mbedtls_timing_get_delay);
  mbedtls_ssl_set_mtu(&P.ssl, 1200);

  /* ---- usrsctp ---- */
  usrsctp_init(0, conn_output, NULL);
  usrsctp_sysctl_set_sctp_ecn_enable(0);
  usrsctp_sysctl_set_sctp_blackhole(2);
  usrsctp_register_address((void *)&P);

  P.sctp = usrsctp_socket(AF_CONN, SOCK_STREAM, IPPROTO_SCTP, sctp_recv_cb, NULL, 0, NULL);
  if (!P.sctp) die("usrsctp_socket", 0);
  usrsctp_set_non_blocking(P.sctp, 1);
  {
    struct sctp_event ev;
    uint16_t types[] = { SCTP_ASSOC_CHANGE, SCTP_PEER_ADDR_CHANGE, SCTP_STREAM_RESET_EVENT };
    memset(&ev, 0, sizeof ev);
    ev.se_assoc_id = SCTP_FUTURE_ASSOC;
    ev.se_on = 1;
    for (size_t i = 0; i < sizeof types / sizeof types[0]; i++) {
      ev.se_type = types[i];
      usrsctp_setsockopt(P.sctp, IPPROTO_SCTP, SCTP_EVENT, &ev, (socklen_t)sizeof ev);
    }
    struct sctp_assoc_value av;
    memset(&av, 0, sizeof av);
    av.assoc_id = SCTP_ALL_ASSOC;
    av.assoc_value = 1;
    usrsctp_setsockopt(P.sctp, IPPROTO_SCTP, SCTP_ENABLE_STREAM_RESET, &av, (socklen_t)sizeof av);
    struct sctp_initmsg im;
    memset(&im, 0, sizeof im);
    im.sinit_num_ostreams = 1024;
    im.sinit_max_instreams = 1024;
    usrsctp_setsockopt(P.sctp, IPPROTO_SCTP, SCTP_INITMSG, &im, (socklen_t)sizeof im);
  }
  {
    struct sockaddr_conn sc;
    memset(&sc, 0, sizeof sc);
    sc.sconn_family = AF_CONN;
    sc.sconn_port = htons(5000);
    sc.sconn_addr = (void *)&P;
    if (usrsctp_bind(P.sctp, (struct sockaddr *)&sc, (socklen_t)sizeof sc) != 0) die("usrsctp_bind", 0);
  }

  /* ---- the loop: ICE, then DTLS, then SCTP ---- */
  uint8_t txid[12];
  mbedtls_ctr_drbg_random(&P.drbg, txid, 12);
  DWORD t0 = GetTickCount();
  DWORD last_check = 0;
  int handshake_started = 0, sctp_connect_started = 0, dcep_sent = 0, data_sent = 0;
  DWORD deadline = t0 + 25000;

  while (GetTickCount() < deadline) {
    /* periodic ICE connectivity check while ICE is not yet usable */
    if (!P.ice_ready && GetTickCount() - last_check > 250) {
      last_check = GetTickCount();
      msg_t m;
      char user[192];
      snprintf(user, sizeof user, "%s:%s", P.r_ufrag, P.l_ufrag);
      mbedtls_ctr_drbg_random(&P.drbg, txid, 12);
      stun_begin(&m, STUN_BINDING_REQ, txid);
      stun_attr(&m, A_USERNAME, user, strlen(user));
      { uint8_t pr[4]; put32(pr, 1845501695u); stun_attr(&m, A_PRIORITY, pr, 4); }
      { uint8_t tb[8]; mbedtls_ctr_drbg_random(&P.drbg, tb, 8); stun_attr(&m, A_ICE_CONTROLLED, tb, 8); }
      stun_add_integrity(&m, P.r_pwd);
      stun_add_fingerprint(&m);
      stun_finish(&m);
      udp_send(m.b, m.n);
    }

    /* drain the socket */
    for (;;) {
      uint8_t buf[2048];
      struct sockaddr_in from;
      int flen = sizeof from;
      int n = recvfrom(P.sock, (char *)buf, sizeof buf, 0, (struct sockaddr *)&from, &flen);
      if (n <= 0) break;
      uint8_t b0 = buf[0];
      if (b0 <= 3) {
        /* STUN */
        uint16_t type = get16(buf);
        if (type == STUN_BINDING_REQ) {
          const uint8_t *u; size_t ul;
          if (stun_find(buf, (size_t)n, A_USERNAME, &u, &ul)) {
            msg_t r;
            stun_begin(&r, STUN_BINDING_RSP, buf + 8);
            uint8_t xa[8];
            xa[0] = 0; xa[1] = 1;
            uint16_t xp = (uint16_t)(ntohs(from.sin_port) ^ (STUN_COOKIE >> 16));
            put16(xa + 2, xp);
            put32(xa + 4, ntohl(from.sin_addr.s_addr) ^ STUN_COOKIE);
            stun_attr(&r, A_XOR_MAPPED, xa, 8);
            stun_add_integrity(&r, P.l_pwd);
            stun_add_fingerprint(&r);
            stun_finish(&r);
            sendto(P.sock, (const char *)r.b, (int)r.n, 0, (struct sockaddr *)&from, flen);
            if (!P.ice_ready) { LOGF("ICE: answered inbound binding request -> path usable"); }
            P.ice_ready = 1;
            P.peer = from;
          }
        } else if (type == STUN_BINDING_RSP) {
          P.binding_responses++;
          if (!P.ice_ready) LOGF("ICE: binding response received -> path usable");
          P.ice_ready = 1;
          P.peer = from;
        }
        continue;
      }
      if (b0 >= 20 && b0 <= 63) {
        /* DTLS record */
        if (n > (int)sizeof bio_buf) continue;
        memcpy(bio_buf, buf, (size_t)n);
        bio_len = (size_t)n;
        if (!P.dtls_ready) {
          rc = mbedtls_ssl_handshake(&P.ssl);
          if (rc == 0) {
            /* THE security gate: the peer's certificate must hash to the
             * fingerprint the signaling channel carried. */
            const mbedtls_x509_crt *pc = mbedtls_ssl_get_peer_cert(&P.ssl);
            if (!pc) die("DTLS completed with no peer certificate", 0);
            uint8_t got[32];
            mbedtls_sha256(pc->raw.p, pc->raw.len, got, 0);
            if (memcmp(got, P.r_fp_bytes, 32) != 0) {
              char a[128], b[128];
              fp_hex(got, 32, a);
              fp_hex(P.r_fp_bytes, 32, b);
              fprintf(stderr, "[probe] FATAL fingerprint mismatch\n  peer cert: %s\n  sdp says : %s\n", a, b);
              return 4;
            }
            LOGF("DTLS handshake OK, peer fingerprint VERIFIED, suite=%s",
                 mbedtls_ssl_get_ciphersuite(&P.ssl));
            P.dtls_ready = 1;
          } else if (rc != MBEDTLS_ERR_SSL_WANT_READ && rc != MBEDTLS_ERR_SSL_WANT_WRITE) {
            die("ssl_handshake", rc);
          }
        } else {
          uint8_t plain[4096];
          int r = mbedtls_ssl_read(&P.ssl, plain, sizeof plain);
          if (r > 0) usrsctp_conninput((void *)&P, plain, (size_t)r, 0);
          else if (r != MBEDTLS_ERR_SSL_WANT_READ && r != MBEDTLS_ERR_SSL_WANT_WRITE && r != 0)
            LOGF("ssl_read rc=-0x%04x", (unsigned)-r);
        }
        continue;
      }
      LOGF("dropped %d bytes with first byte %u", n, (unsigned)b0);
    }

    if (P.ice_ready && !handshake_started) {
      handshake_started = 1;
      LOGF("starting DTLS client handshake");
      rc = mbedtls_ssl_handshake(&P.ssl);
      if (rc != 0 && rc != MBEDTLS_ERR_SSL_WANT_READ && rc != MBEDTLS_ERR_SSL_WANT_WRITE)
        die("ssl_handshake(initial)", rc);
    }

    if (P.dtls_ready && !sctp_connect_started) {
      sctp_connect_started = 1;
      struct sockaddr_conn sc;
      memset(&sc, 0, sizeof sc);
      sc.sconn_family = AF_CONN;
      sc.sconn_port = htons(5000);
      sc.sconn_addr = (void *)&P;
      LOGF("SCTP connect (AF_CONN, port 5000)");
      usrsctp_connect(P.sctp, (struct sockaddr *)&sc, (socklen_t)sizeof sc);
    }

    if (P.sctp_up == 1 && !dcep_sent) { dcep_sent = 1; send_dcep_open(); }

    if (P.dcep_acked && !data_sent) {
      data_sent = 1;
      uint8_t payload[5] = { 0x00, 0x01, 0x02, 0x03, 0x04 };
      LOGF("-> SCTP data ppid=53 stream=0 hex=0001020304");
      sctp_send(0, PPID_BINARY, 1, payload, sizeof payload);
    }

    if (P.got_echo) {
      printf("RESULT-BEGIN\n");
      printf("echo_len=%d\n", P.echo_len);
      printf("echo_hex=");
      for (int i = 0; i < P.echo_len; i++) printf("%02x", P.echo[i]);
      printf("\n");
      printf("ciphersuite=%s\n", mbedtls_ssl_get_ciphersuite(&P.ssl));
      printf("fingerprint_verified=1\n");
      printf("stun_binding_responses=%d\n", P.binding_responses);
      printf("RESULT-END\n");
      fflush(stdout);
      usrsctp_close(P.sctp);
      return 0;
    }

    if (P.dtls_ready) {
      /* keep mbedTLS timers turning during the flight */
      uint8_t plain[4096];
      int r = mbedtls_ssl_read(&P.ssl, plain, sizeof plain);
      if (r > 0) usrsctp_conninput((void *)&P, plain, (size_t)r, 0);
    }
    Sleep(2);
  }

  LOGF("TIMEOUT ice=%d dtls=%d sctp_up=%d dcep_acked=%d", P.ice_ready, P.dtls_ready, P.sctp_up, P.dcep_acked);
  printf("RESULT-BEGIN\nstopped_at=%s\nRESULT-END\n",
         !P.ice_ready ? "ice" : !P.dtls_ready ? "dtls" : P.sctp_up != 1 ? "sctp-assoc" : !P.dcep_acked ? "dcep-ack" : "echo");
  fflush(stdout);
  return 1;
}
