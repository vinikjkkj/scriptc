/* node:tls + node:https — the TLS transport under the socket kind,
 * layered exactly the way scr_http.c layers on scr_net.c: the socket
 * surface (ScrNetSocket, and the http req/res/client handles above it)
 * is unchanged, and this unit plugs the ScrNetTransportOps table into
 * the socket so reads decrypt, writes encrypt, and readiness drives the
 * handshake. Link-gated like every optional unit: TLS-free binaries
 * never compile this file or the vendored library.
 *
 * ── Design note (the TLS provider decision) ──────────────────────────
 *
 * The provider is VENDORED mbedTLS (3.6 LTS, Apache-2.0, ~1.2MB
 * archive, see vendor/README.md). The alternatives and why they lost:
 *
 * - Security.framework / SecureTransport: zero vendoring and present on
 *   every macOS, but (a) deprecated since 10.15 with no non-deprecated
 *   replacement below Network.framework's connection model, (b) macOS-
 *   only — the queued Linux port would need a second backend behind the
 *   same ops table, and (c) DISQUALIFYING for this program: a server
 *   identity must be a SecIdentity, which public API only mints through
 *   a keychain import — portless mints per-hostname cert/key PEM FILES
 *   with openssl and loads them headlessly; a temp-keychain dance per
 *   certificate is exactly the fragility this compiler avoids.
 * - BoringSSL: no releases/versioning to pin, a CMake+Go build, and an
 *   order of magnitude more code than the slice needs.
 * - LibreSSL libtls: the cleanest API of the four, but macOS ships no
 *   linkable libtls (the system LibreSSL is the CLI only) — it would be
 *   a brew dependency whose availability varies, weaker than the
 *   libcurl precedent (libcurl is a macOS SYSTEM library).
 *
 * mbedTLS wins on the two axes that matter here: PEM cert/key/CA
 * loading is first-class (mbedtls_x509_crt_parse / pk_parse_key over
 * bytes — the portless local-CA flow needs nothing else), and the same
 * vendored tree compiles unchanged on Linux, so the port pays zero
 * extra. It builds as plain C11 with the stock config (no generator
 * scripts, no CMake — the libregexp cache precedent), and its
 * nonblocking BIO contract (WANT_READ/WANT_WRITE) maps 1:1 onto the
 * kqueue readiness loop. Migration cost if ever needed: everything
 * mbedTLS-specific lives behind ScrNetTransportOps in this one file.
 *
 * ── The wiring ────────────────────────────────────────────────────────
 *
 * Server: tls.createServer(cert, key, handler) is an ordinary
 * ScrNetServer whose native-connection hook installs the transport on
 * each accepted socket and whose 'connection' listeners are DEFERRED to
 * handshake completion — the handler is Node's 'secureConnection', fired
 * with a socket that then behaves exactly like a net socket.
 * https.createServer is scr_http_create_server with its parser hook
 * WRAPPED: the TLS hook installs the transport first and attaches the
 * http parser from on_established, so the parser only ever sees
 * plaintext. Handshake failures on the server side tear the socket down
 * SILENTLY — Node's default for 'tlsClientError' with no listener, which
 * is what portless observes (it registers none).
 *
 * Client: https.request is scr_http_request_ex with a wrap hook that
 * installs a client transport on the freshly dialed socket; the request
 * head buffers in the socket's write buffer until the handshake
 * establishes (the mid-connect buffering path, reused verbatim).
 * rejectUnauthorized:false maps to VERIFY_NONE; `ca` replaces the trust
 * anchors; with neither, /etc/ssl/cert.pem stands in for Node's bundled
 * Mozilla roots (SEMANTICS.md documents the divergence). Verify
 * failures surface as Node-shaped 'error' messages on the request
 * ("self-signed certificate", "self-signed certificate in certificate
 * chain", "unable to verify the first certificate", "certificate has
 * expired") through the socket's pending-error sweep — then 'close',
 * Node's order, exactly like ECONNREFUSED.
 *
 * Bounds (SEMANTICS.md divergence 55): no session resumption or
 * tickets, no renegotiation/post-handshake auth, no client
 * certificates, hostname verification is skipped for IP-literal peers
 * (mbedTLS has no IP-SAN matching in 3.6), and non-verify client
 * handshake failures carry a generic message where Node prints an
 * OpenSSL one. */
#include "scr_runtime.h"
#include "scr_tls_ciph.h"

#include <ctype.h>
#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef _MSC_VER
#include <unistd.h>
#endif
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h> /* inet_pton, in6_addr */
#include <wincrypt.h> /* CertOpenSystemStoreW — the ROOT store, see scr_tls_system_ca */
#else
#include <arpa/inet.h>
#endif

/* The session fields below are read for resumption (scr_tls_resumed): mbedTLS
 * 3.6 exports a session ONCE (mbedtls_ssl_get_session fails on a second
 * export), and the handshake state that records the resumption is freed at
 * wrapup, so the negotiated session's identity is the only public-enough
 * signal. This only names members that already exist; the layout is unchanged. */
#define MBEDTLS_ALLOW_PRIVATE_ACCESS
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/entropy.h"
#include "mbedtls/error.h"
#include "mbedtls/oid.h"
#include "mbedtls/net_sockets.h" /* the MBEDTLS_ERR_NET_* codes the BIOs answer */
#include "mbedtls/pk.h"
#include "mbedtls/ssl.h"
#include "mbedtls/x509_crt.h"

static void scr_tls_oom(void) {
  fputs("scriptc: out of memory\n", stderr);
  abort();
}

#ifdef _WIN32
/* ── the winsock arm (scr_net.c's respelling, the two calls this unit
 * makes) ──────────────────────────────────────────────────────────────
 * The BIOs and the SNI pre-parse do raw fd I/O beside the socket's own
 * transport plumbing, so the same one-time respelling applies: socket
 * reads are recv, writes are send (ReadFile/_read do not apply to
 * winsock handles), and failures land their WSA code in errno TRANSLATED
 * to the POSIX constant the call sites test. WSAECONNABORTED joins the
 * reset arm deliberately: at the TLS layer both spell "the peer died",
 * and the reset arms (CONN_RESET → silent server teardown / the client's
 * socket-hang-up classification) are Node's rendering for each. Winsock
 * is already started whenever this unit runs — every TLS socket is an
 * ScrNetSocket, and scr_net.c initializes the poller (WSAStartup) before
 * any socket exists. */
static int scr_tls_w32_map_err(int e) {
  switch (e) {
  case WSAEWOULDBLOCK: return EAGAIN;
  case WSAEINTR: return EINTR;
  case WSAECONNRESET: return ECONNRESET;
  case WSAECONNABORTED: return ECONNRESET;
  case WSAESHUTDOWN: return EPIPE; /* libuv's map: send-after-shutdown is EPIPE */
  default: return e;
  }
}

static ssize_t scr_tls_w32_read(int fd, void *buf, size_t len) {
  int n = recv((SOCKET)fd, (char *)buf, len > 0x40000000 ? 0x40000000 : (int)len, 0);
  if (n < 0) errno = scr_tls_w32_map_err((int)WSAGetLastError());
  return n;
}

static ssize_t scr_tls_w32_write(int fd, const void *buf, size_t len) {
  int n = send((SOCKET)fd, (const char *)buf, len > 0x40000000 ? 0x40000000 : (int)len, 0);
  if (n < 0) errno = scr_tls_w32_map_err((int)WSAGetLastError());
  return n;
}

#define read(fd, buf, len) scr_tls_w32_read((fd), (buf), (len))
#define write(fd, buf, len) scr_tls_w32_write((fd), (buf), (len))
#endif /* _WIN32 */

/* ── the unit RNG (one CTR_DRBG, lazily seeded) ──────────────────────── */

static mbedtls_entropy_context scr_tls_entropy;
static mbedtls_ctr_drbg_context scr_tls_drbg;
static bool scr_tls_rng_ready = false;

/* Defined with the dyn-member hooks at the tail of this file; registered
 * from rng_init so every TLS entry point installs the TLSSocket member
 * dispatch before any TLS socket can reach a dyn binding. */
static const ScrNetDynhTlsHooks SCR_TLS_DYNH;

static void scr_tls_rng_init(void) {
  if (scr_tls_rng_ready) return;
  mbedtls_entropy_init(&scr_tls_entropy);
  mbedtls_ctr_drbg_init(&scr_tls_drbg);
  if (mbedtls_ctr_drbg_seed(&scr_tls_drbg, mbedtls_entropy_func, &scr_tls_entropy,
                            (const unsigned char *)"scriptc-tls", 11) != 0) {
    fputs("scriptc: tls: RNG seeding failed\n", stderr);
    abort();
  }
  scr_net_set_dynh_tls(&SCR_TLS_DYNH);
  scr_tls_rng_ready = true;
}

/* PEM parsers want a NUL-terminated buffer with the NUL counted. */
static int scr_tls_parse_crt(mbedtls_x509_crt *crt, const char *pem, size_t len) {
  unsigned char *buf = malloc(len + 1);
  if (!buf) scr_tls_oom();
  memcpy(buf, pem, len);
  buf[len] = 0;
  int r = mbedtls_x509_crt_parse(crt, buf, len + 1);
  free(buf);
  return r;
}

static int scr_tls_parse_key(mbedtls_pk_context *pk, const char *pem, size_t len) {
  unsigned char *buf = malloc(len + 1);
  if (!buf) scr_tls_oom();
  memcpy(buf, pem, len);
  buf[len] = 0;
  int r = mbedtls_pk_parse_key(pk, buf, len + 1, NULL, 0, mbedtls_ctr_drbg_random,
                               &scr_tls_drbg);
  free(buf);
  return r;
}

/* Bad cert/key material is a construction-time crash in Node (createServer
 * throws); this runtime's shape for it is the print-and-die trap. */
static void scr_tls_bad_material(const char *what, int err) {
  char detail[128];
  mbedtls_strerror(err, detail, sizeof detail);
  fflush(stdout);
  fprintf(stderr, "scriptc: tls: failed to parse %s (%s)\n", what, detail);
  _Exit(1);
}

/* ── SecureContext (tls.createSecureContext) ─────────────────────────── */

/* An opaque refcounted parsed cert/key pair — what an SNI callback
 * answers with; the handshake serves it via mbedtls_ssl_set_hs_own_cert. */
struct ScrSecureCtx {
  size_t rc;
  mbedtls_x509_crt cert;
  mbedtls_pk_context pk;
  /* which halves of the identity were given (createSecureContext takes
   * cert and key independently; an SNI answer needs both). */
  bool has_cert, has_key;
  /* minVersion/maxVersion, retained as SCR_TLS_V_* (0 = unset). */
  int minv, maxv;
  /* the `ca` PEM bundle, retained (+1) for the client trust store. */
  ScrBytes *ca;
};


#ifdef SCR_RC_AUDIT
static long scr_live_secure_ctx = 0;
long scr_secure_ctx_live_count(void) { return scr_live_secure_ctx; }
#endif

static ScrSecureCtx *scr_secure_ctx_alloc(void) {
  ScrSecureCtx *c = calloc(1, sizeof *c);
  if (!c) scr_tls_oom();
  c->rc = 1;
  mbedtls_x509_crt_init(&c->cert);
  mbedtls_pk_init(&c->pk);
#ifdef SCR_RC_AUDIT
  scr_live_secure_ctx++;
#endif
  return c;
}

ScrSecureCtx *scr_tls_create_secure_context(const char *cert, size_t cert_len,
                                             const char *key, size_t key_len) {
  scr_tls_rng_init();
  ScrSecureCtx *c = scr_secure_ctx_alloc();
  int r = scr_tls_parse_crt(&c->cert, cert, cert_len);
  if (r != 0) scr_tls_bad_material("certificate", r);
  r = scr_tls_parse_key(&c->pk, key, key_len);
  if (r != 0) scr_tls_bad_material("private key", r);
  c->has_cert = c->has_key = true;
  return c;
}

ScrSecureCtx *scr_secure_ctx_retain(ScrSecureCtx *c) {
  if (c) c->rc++;
  return c;
}

void scr_secure_ctx_release(ScrSecureCtx *c) {
  if (!c || --c->rc != 0) return;
  mbedtls_x509_crt_free(&c->cert);
  mbedtls_pk_free(&c->pk);
  scr_bytes_release(c->ca);
  free(c);
#ifdef SCR_RC_AUDIT
  scr_live_secure_ctx--;
#endif
}

void *scr_secure_ctx_retain_v(void *p) { return scr_secure_ctx_retain((ScrSecureCtx *)p); }
void scr_secure_ctx_release_v(void *p) { scr_secure_ctx_release((ScrSecureCtx *)p); }

/* ── SecureContext in the checked-dynamic tree (SCR_DYNH_SECURE_CTX) ──────
 * A context is an opaque handle: it boxes by REFERENCE (retain the one
 * parsed pair, so the same context comes back out of an 'unknown' slot
 * with its identity intact). Node's SecureContext has no public member
 * surface in JS beyond its internal `context`, so every member call answers
 * Node's "is not a function" and no property is modeled. */
static ScrDyn *scr_secure_ctx_dynh_invoke(void *h, ScrDyn *self, const char *method,
                                          ScrDyn *const *args, size_t argc, const char *what) {
  (void)h; (void)self; (void)method; (void)args; (void)argc;
  char msg[160];
  const int n = snprintf(msg, sizeof msg, "%s is not a function", what);
  scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
  return NULL;
}

static ScrDyn *scr_secure_ctx_dynh_get(void *h, const char *key, size_t key_len) {
  (void)h; (void)key; (void)key_len;
  return NULL; /* no modeled property: the caller answers undefined */
}

static bool scr_secure_ctx_dynh_set(void *h, const char *key, size_t key_len, const ScrDyn *value) {
  (void)h; (void)key; (void)key_len; (void)value;
  return false;
}

static const ScrDynHandleOps scr_secure_ctx_dynh_ops = {
  "SecureContext",
  &scr_secure_ctx_retain_v,
  &scr_secure_ctx_release_v,
  &scr_secure_ctx_dynh_invoke,
  &scr_secure_ctx_dynh_get,
  &scr_secure_ctx_dynh_set,
  NULL, /* no pipe destination */
  NULL, /* no expandos: a SecureContext takes no JS own properties */
};

void scr_tls_dyn_install(void) {
  scr_dyn_handle_install(SCR_DYNH_SECURE_CTX, &scr_secure_ctx_dynh_ops);
}

/* ── the server config (one per created server, rc'd) ────────────────── */

typedef struct ScrTlsSrv {
  size_t rc;
  mbedtls_ssl_config conf;
  mbedtls_x509_crt cert;
  mbedtls_pk_context pk;
  /* https: the wrapped http-parser connection hook, attached from
   * on_established so it only ever sees plaintext */
  ScrNetNativeConnFn inner_conn;
  void *inner_ctx;
  void (*inner_ctx_free)(void *);
  /* h2 over TLS (http2.createSecureServer): the h2 session attach —
   * on_established dispatches on the NEGOTIATED protocol (h2 → this
   * hook; http/1.1 → inner_conn; no answer → teardown). */
  ScrNetNativeConnFn h2_conn;
  void *h2_ctx;
  void (*h2_ctx_free)(void *);
  /* SNI: the JS SNICallback (owned, nullable) and the emitted answer
   * thunk that becomes each minted answer closure's fn */
  ScrClosure *sni_cb;
  void *sni_answer_fn;
} ScrTlsSrv;

/* The ALPN answers (static storage — mbedTLS keeps the pointers). Plain
 * tls servers configure none, like Node; https advertises http/1.1; the
 * h2 secure server advertises h2 alone (an http/1.1-only client fails
 * the handshake with no_application_protocol — Node's h2-only split). */
static const char *SCR_TLS_ALPN_HTTP11[] = {"http/1.1", NULL};
static const char *SCR_TLS_ALPN_H2[] = {"h2", NULL};

static ScrTlsSrv *scr_tls_srv_new(const char *cert, size_t cert_len, const char *key,
                                   size_t key_len, bool alpn_http11) {
  scr_tls_rng_init();
  ScrTlsSrv *s = calloc(1, sizeof *s);
  if (!s) scr_tls_oom();
  s->rc = 1;
  mbedtls_x509_crt_init(&s->cert);
  mbedtls_pk_init(&s->pk);
  mbedtls_ssl_config_init(&s->conf);
  int r = scr_tls_parse_crt(&s->cert, cert, cert_len);
  if (r != 0) scr_tls_bad_material("certificate", r);
  r = scr_tls_parse_key(&s->pk, key, key_len);
  if (r != 0) scr_tls_bad_material("private key", r);
  if (mbedtls_ssl_config_defaults(&s->conf, MBEDTLS_SSL_IS_SERVER,
                                  MBEDTLS_SSL_TRANSPORT_STREAM,
                                  MBEDTLS_SSL_PRESET_DEFAULT) != 0) {
    scr_tls_oom();
  }
  mbedtls_ssl_conf_rng(&s->conf, mbedtls_ctr_drbg_random, &scr_tls_drbg);
  mbedtls_ssl_conf_authmode(&s->conf, MBEDTLS_SSL_VERIFY_NONE); /* no client certs, Node's default */
  if (mbedtls_ssl_conf_own_cert(&s->conf, &s->cert, &s->pk) != 0) {
    scr_tls_bad_material("certificate/key pair", 0);
  }
  if (alpn_http11) mbedtls_ssl_conf_alpn_protocols(&s->conf, SCR_TLS_ALPN_HTTP11);
  return s;
}

static ScrTlsSrv *scr_tls_srv_retain(ScrTlsSrv *s) {
  s->rc++;
  return s;
}

static void scr_tls_srv_release(ScrTlsSrv *s) {
  if (!s || --s->rc != 0) return;
  if (s->inner_ctx_free) s->inner_ctx_free(s->inner_ctx);
  if (s->h2_ctx_free) s->h2_ctx_free(s->h2_ctx);
  scr_closure_release(s->sni_cb);
  mbedtls_ssl_config_free(&s->conf);
  mbedtls_x509_crt_free(&s->cert);
  mbedtls_pk_free(&s->pk);
  free(s);
}

static void scr_tls_srv_release_v(void *p) { scr_tls_srv_release((ScrTlsSrv *)p); }

/* ── the client config (one per https.request, owned by its tctx) ────── */

typedef struct ScrTlsCli {
  mbedtls_ssl_config conf;
  mbedtls_x509_crt ca;
  char *hostname; /* NULL for IP-literal peers (no SNI, no name check) */
  /* true when the handshake RECORDS verification (VERIFY_OPTIONAL /
   * VERIFY_REQUIRED) — socket.authorized answers from the result; a
   * VERIFY_NONE socket (the https client's rejectUnauthorized:false)
   * never verified, so authorized answers false like Node's. */
  bool verify_recorded;
  /* the user's checkServerIdentity (owned; NULL = the builtin mbedTLS name check) */
  ScrDyn *identity;
  bool reject;      /* rejectUnauthorized: a failed identity fails the connection */
  char *verify_name; /* the name Node passes as hostname (servername/host/IP, never NULL) */
  /* tls.connect's `session` option: the decoded mbedTLS session, offered on
   * the handshake (mbedtls_ssl_set_session). NULL = a full handshake. Owned. */
  mbedtls_ssl_session *resume;
} ScrTlsCli;

/* The default trust anchors when no `ca` option is given: the system
 * bundle, standing in for Node's compiled-in Mozilla roots. Probed once
 * across the distro spellings — /etc/ssl/cert.pem first (macOS ships it;
 * Alpine links it), then Debian/Ubuntu's ca-certificates.crt,
 * Fedora/RHEL's ca-bundle.crt, and openSUSE's ca-bundle.pem. On macOS
 * only the first path exists, so the probe order changes nothing there.
 * A host with none leaves the chain empty: verification fails, exactly
 * the no-roots behavior /etc/ssl/cert.pem-only had. Windows used to be
 * that host by construction (no PEM bundle ships; the OS store is
 * cert-database-shaped) and therefore trusted NOTHING — which agreed
 * with the oracle wherever the FIXTURES tread, because their CAs are
 * local and are not in Node's Mozilla roots either, and disagreed with
 * it everywhere a real program dials a public host. The win32 arm below
 * reads the OS ROOT store, which is this target's spelling of the same
 * host trust these four paths stand in for. */
static mbedtls_x509_crt scr_tls_system_roots;
static bool scr_tls_system_roots_loaded = false;

/* setDefaultCACertificates' replacement anchors (scr_tls_ca.c — always
 * compiled alongside this unit): parsed lazily per generation, so each
 * set re-parses once and every later dial reuses the chain. An EMPTY
 * replacement keeps an initialized, certificate-free chain — every
 * verification fails, Node's own consequence of trusting nothing. */
static mbedtls_x509_crt scr_tls_override_roots;
static uint64_t scr_tls_override_parsed_gen = 0;

static mbedtls_x509_crt *scr_tls_system_ca(void) {
  const char *pem = NULL;
  size_t pem_len = 0;
  uint64_t gen = 0;
  if (scr_tls_ca_default_override(&pem, &pem_len, &gen)) {
    if (gen != scr_tls_override_parsed_gen) {
      if (scr_tls_override_parsed_gen != 0) mbedtls_x509_crt_free(&scr_tls_override_roots);
      mbedtls_x509_crt_init(&scr_tls_override_roots);
      /* +1 for the NUL — mbedTLS's PEM mode wants it counted. A parse
       * failure inside one block leaves the chain with the blocks that
       * did parse (the scr_tls_ca.c divergence note). */
      if (pem_len > 0) (void)mbedtls_x509_crt_parse(&scr_tls_override_roots, (const unsigned char *)pem, pem_len + 1);
      scr_tls_override_parsed_gen = gen;
    }
    return &scr_tls_override_roots;
  }
  if (!scr_tls_system_roots_loaded) {
    scr_tls_system_roots_loaded = true;
    mbedtls_x509_crt_init(&scr_tls_system_roots);
    static const char *const bundles[] = {
        "/etc/ssl/cert.pem",                  /* macOS, Alpine */
        "/etc/ssl/certs/ca-certificates.crt", /* Debian/Ubuntu */
        "/etc/pki/tls/certs/ca-bundle.crt",   /* Fedora/RHEL */
        "/etc/ssl/ca-bundle.pem",             /* openSUSE */
    };
    for (size_t i = 0; i < sizeof bundles / sizeof bundles[0]; i++) {
      if (mbedtls_x509_crt_parse_file(&scr_tls_system_roots, bundles[i]) == 0) break;
    }
#ifdef _WIN32
    /* Windows answers NONE of the paths above -- it ships no PEM bundle,
     * because its trust is a certificate DATABASE. That left the chain
     * EMPTY on this target, so a compiled binary could not verify any
     * public certificate at all and every https/wss dial failed with
     * 'unable to verify the first certificate' unless the operator
     * exported NODE_EXTRA_CA_CERTS. Node has no such requirement: it
     * carries a compiled-in Mozilla root store (tls.rootCertificates,
     * 145 entries on v25.9.0) and verifies out of the box. The OS ROOT
     * store is this target's spelling of the same host trust the four
     * bundle paths above stand in for on POSIX, so reading it here is
     * the win32 arm of a probe that already exists rather than a new
     * policy. Certificates arrive DER-encoded, one context at a time; a
     * context that fails to parse is skipped, exactly like a bundle
     * whose blocks partly fail. Read once, behind the same
     * scr_tls_system_roots_loaded latch as the POSIX arm. */
    {
      HCERTSTORE store = CertOpenSystemStoreW(0, L"ROOT");
      if (store != NULL) {
        PCCERT_CONTEXT ctx = NULL;
        while ((ctx = CertEnumCertificatesInStore(store, ctx)) != NULL) {
          if ((ctx->dwCertEncodingType & X509_ASN_ENCODING) != 0 && ctx->pbCertEncoded != NULL &&
              ctx->cbCertEncoded > 0) {
            (void)mbedtls_x509_crt_parse_der(&scr_tls_system_roots, ctx->pbCertEncoded,
                                             (size_t)ctx->cbCertEncoded);
          }
        }
        CertCloseStore(store, 0);
      }
    }
#endif /* _WIN32 */
    /* NODE_EXTRA_CA_CERTS EXTENDS the trust anchors for real dials --
     * that is what the variable does in Node, and scr_tls_ca.c only
     * ever surfaced it to the INTROSPECTION api (getCACertificates
     * ('extra')). The distinction is invisible on a Linux host, where
     * one of the bundle paths above answers; on win32 there is no path
     * in the list at all, so before this the chain was EMPTY and every
     * https/wss verification failed with 'unable to verify the first
     * certificate' (measured, dialing wss://web.whatsapp.com). Parsed
     * after the bundles so a system store still wins first place in
     * the chain, exactly like Node's append. */
    {
      const char *extra = getenv("NODE_EXTRA_CA_CERTS");
      if (extra != NULL && extra[0] != '\0') {
        (void)mbedtls_x509_crt_parse_file(&scr_tls_system_roots, extra);
      }
    }
  }
  return &scr_tls_system_roots;
}

/* `verify_optional` is tls.connect's rejectUnauthorized:false: the
 * handshake proceeds regardless of the verdict but verification still
 * RUNS and records (socket.authorized / authorizationError answer
 * Node's split); the https client's historical false keeps VERIFY_NONE
 * (verify_optional false there — nothing recorded, nothing read). */
static ScrTlsCli *scr_tls_cli_new2(ScrStr *host, bool reject_unauthorized, const char *ca,
                                    size_t ca_len, bool verify_optional) {
  scr_tls_rng_init();
  ScrTlsCli *c = calloc(1, sizeof *c);
  if (!c) scr_tls_oom();
  mbedtls_ssl_config_init(&c->conf);
  mbedtls_x509_crt_init(&c->ca);
  if (mbedtls_ssl_config_defaults(&c->conf, MBEDTLS_SSL_IS_CLIENT,
                                  MBEDTLS_SSL_TRANSPORT_STREAM,
                                  MBEDTLS_SSL_PRESET_DEFAULT) != 0) {
    scr_tls_oom();
  }
  mbedtls_ssl_conf_rng(&c->conf, mbedtls_ctr_drbg_random, &scr_tls_drbg);
#if defined(MBEDTLS_SSL_PROTO_TLS1_3) && defined(MBEDTLS_SSL_SESSION_TICKETS)
  /* mbedTLS 3.6's default DISCARDS a TLS 1.3 NewSessionTicket (the handling
   * is disabled so existing applications see no new error code). Node keeps
   * tickets, and resumption needs them: enable the ticket path, which hands
   * each ticket to mbedtls_ssl_read as MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET
   * after storing it in the session (xread and the handshake pump absorb it). */
  mbedtls_ssl_conf_tls13_enable_signal_new_session_tickets(
      &c->conf, MBEDTLS_SSL_TLS1_3_SIGNAL_NEW_SESSION_TICKETS_ENABLED);
#endif
  c->verify_recorded = reject_unauthorized || verify_optional;
  if (ca_len > 0) {
    int r = scr_tls_parse_crt(&c->ca, ca, ca_len);
    if (r != 0) scr_tls_bad_material("ca certificate", r);
  }
  if (!reject_unauthorized && !verify_optional) {
    mbedtls_ssl_conf_authmode(&c->conf, MBEDTLS_SSL_VERIFY_NONE);
  } else {
    mbedtls_ssl_conf_authmode(&c->conf, reject_unauthorized ? MBEDTLS_SSL_VERIFY_REQUIRED
                                                            : MBEDTLS_SSL_VERIFY_OPTIONAL);
    mbedtls_ssl_conf_ca_chain(&c->conf, ca_len > 0 ? &c->ca : scr_tls_system_ca(), NULL);
  }
  /* SNI + name verification want the DNS name; an IP literal gets
   * neither (mbedTLS 3.6 has no IP-SAN matching — SEMANTICS.md). */
  struct in_addr a4;
  struct in6_addr a6;
  const char *h = host->len > 0 ? host->data : "localhost";
  c->verify_name = strdup(h);
  if (!c->verify_name) scr_tls_oom();
  c->reject = reject_unauthorized;
  if (inet_pton(AF_INET, h, &a4) != 1 && inet_pton(AF_INET6, h, &a6) != 1) {
    c->hostname = strdup(h);
    if (!c->hostname) scr_tls_oom();
  }
  return c;
}

static ScrTlsCli *scr_tls_cli_new(ScrStr *host, bool reject_unauthorized, const char *ca,
                                   size_t ca_len) {
  return scr_tls_cli_new2(host, reject_unauthorized, ca, ca_len, false);
}

static void scr_tls_cli_free(ScrTlsCli *c) {
  mbedtls_ssl_config_free(&c->conf);
  mbedtls_x509_crt_free(&c->ca);
  free(c->hostname);
  scr_dyn_release(c->identity);
  free(c->verify_name);
  if (c->resume != NULL) {
    mbedtls_ssl_session_free(c->resume);
    free(c->resume);
  }
  free(c);
}

/* ── the per-socket transport ────────────────────────────────────────── */

/* The SNI pre-parse states: NONE (no callback on the server — the
 * handshake runs directly), COLLECT (buffering the ClientHello),
 * WAIT (the JS callback is deciding), DONE (answered/skipped — the
 * hello replayed into the bio; the handshake runs). */
enum { SCR_SNI_NONE = 0, SCR_SNI_COLLECT, SCR_SNI_WAIT, SCR_SNI_DONE };

typedef struct ScrTlsSock {
  mbedtls_ssl_context ssl;
  ScrNetSocket *sock; /* BORROWED: the tctx lives and dies with the socket */
  ScrTlsSrv *srv;     /* +1 server side, NULL client side */
  ScrTlsCli *cli;     /* owned client side, NULL server side */
  bool notify_sent;
  bool established; /* the handshake stood — socket.authorized reads gate on it */
  /* the client 'session' event: listeners + the fired-once latch (Node
   * fires per received ticket; this surface fires once per socket) */
  ScrNetLs session_ls;
  bool session_fired;
  bool resumed; /* the handshake resumed the offered session (isSessionReused) */
  /* what the verify callback saw (the peer chain is gone once the
   * handshake has failed, so the shape is recorded as it verifies) */
  bool vrfy_leaf_self;
  bool vrfy_chain_self;
  bool vrfy_expired;
  bool vrfy_cn_mismatch;
  /* SNI pre-parse state (server side with an SNI callback only) */
  int sni_state;
  bool in_handshake;   /* a synchronous cb answer must not re-pump */
  unsigned char *hello; /* the raw ClientHello flight, replayed at DONE */
  size_t hello_len, hello_cap;
  ScrSecureCtx *sni_ctx; /* owned; the answer (NULL = default cert) */
} ScrTlsSock;

/* The client verify callback: records WHERE verification failed and how
 * the presented chain is shaped, per certificate (depth 0 = leaf), so
 * the failure message can be Node's exact split. Never overrides flags —
 * the verdict stays mbedTLS's. */
static int scr_tls_vrfy_cb(void *ctx, mbedtls_x509_crt *crt, int depth, uint32_t *flags) {
  ScrTlsSock *t = (ScrTlsSock *)ctx;
  bool self = crt->issuer_raw.len == crt->subject_raw.len &&
              memcmp(crt->issuer_raw.p, crt->subject_raw.p, crt->subject_raw.len) == 0;
  /* a user checkServerIdentity REPLACES mbedTLS's name check (Node's rule): the
   * CN flag is not a verdict then, and the identity run decides it */
  if (t->cli != NULL && t->cli->identity != NULL) *flags &= ~MBEDTLS_X509_BADCERT_CN_MISMATCH;
  if (*flags & MBEDTLS_X509_BADCERT_EXPIRED) t->vrfy_expired = true;
  if (*flags & MBEDTLS_X509_BADCERT_CN_MISMATCH) t->vrfy_cn_mismatch = true;
  if (*flags & MBEDTLS_X509_BADCERT_NOT_TRUSTED) {
    if (depth == 0 && self) t->vrfy_leaf_self = true;
    if (depth > 0 && self) t->vrfy_chain_self = true;
  }
  return 0;
}

/* The BIOs: nonblocking fd I/O in mbedTLS's own convention. A send that
 * would block arms the socket's write filter so the handshake resumes on
 * writability. */
static int scr_tls_bio_send(void *ctx, const unsigned char *buf, size_t len) {
  ScrTlsSock *t = (ScrTlsSock *)ctx;
  int fd = scr_net_sock_fd(t->sock);
  if (fd < 0) return MBEDTLS_ERR_NET_CONN_RESET;
  ssize_t n = write(fd, buf, len);
  if (n >= 0) return (int)n;
  if (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) {
    scr_net_sock_transport_want_write(t->sock);
    return MBEDTLS_ERR_SSL_WANT_WRITE;
  }
  if (errno == EPIPE || errno == ECONNRESET) return MBEDTLS_ERR_NET_CONN_RESET;
  return MBEDTLS_ERR_NET_SEND_FAILED;
}

static int scr_tls_bio_recv(void *ctx, unsigned char *buf, size_t len) {
  ScrTlsSock *t = (ScrTlsSock *)ctx;
  int fd = scr_net_sock_fd(t->sock);
  if (fd < 0) return MBEDTLS_ERR_NET_CONN_RESET;
  /* bytes a consumer peeked and unshifted (the demux path) re-enter the
   * stream here, ahead of the kernel's */
  size_t took = scr_net_sock_take_buffered(t->sock, (char *)buf, len);
  if (took > 0) return (int)took;
  ssize_t n = read(fd, buf, len);
  if (n >= 0) return (int)n; /* 0 = EOF; mbedTLS maps it to CONN_EOF */
  if (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) {
    return MBEDTLS_ERR_SSL_WANT_READ;
  }
  if (errno == ECONNRESET) return MBEDTLS_ERR_NET_CONN_RESET;
  return MBEDTLS_ERR_NET_RECV_FAILED;
}

/* ── the transport ops ───────────────────────────────────────────────── */

static void scr_tls_fire_session(ScrTlsSock *t);
static bool scr_tls_resumed(ScrTlsSock *t);

static ssize_t scr_tls_xread(void *tctx, char *buf, size_t n) {
  ScrTlsSock *t = (ScrTlsSock *)tctx;
  for (;;) {
    int r = mbedtls_ssl_read(&t->ssl, (unsigned char *)buf, n);
    if (r > 0) return r;
    if (r == 0 || r == MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY || r == MBEDTLS_ERR_SSL_CONN_EOF) {
      return 0; /* orderly (or abrupt-but-quiet) EOF — Node's 'end' either way */
    }
#if defined(MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET)
    if (r == MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET) {
      /* a 1.3 ticket, not app data: the client 'session' event's moment */
      if (!scr_exc_pending()) scr_tls_fire_session(t);
      continue;
    }
#endif
    if (r == MBEDTLS_ERR_SSL_WANT_READ || r == MBEDTLS_ERR_SSL_WANT_WRITE) {
      errno = EAGAIN;
      return -1;
    }
    errno = ECONNRESET; /* protocol-level death reads as a reset */
    return -1;
  }
}

static ssize_t scr_tls_xwrite(void *tctx, const char *buf, size_t n) {
  ScrTlsSock *t = (ScrTlsSock *)tctx;
  int r = mbedtls_ssl_write(&t->ssl, (const unsigned char *)buf, n);
  if (r >= 0) return r;
  if (r == MBEDTLS_ERR_SSL_WANT_READ || r == MBEDTLS_ERR_SSL_WANT_WRITE) {
    errno = EAGAIN;
    return -1;
  }
  errno = EPIPE;
  return -1;
}

/* Node's message for the verify failures the local-CA flows can meet.
 * The split mirrors Node's openssl-error mapping: a self-signed LEAF is
 * "self-signed certificate"; a chain that carries its own (self-signed)
 * root is "self-signed certificate in certificate chain"; a chain whose
 * issuer never arrived is "unable to verify the first certificate". The
 * shape comes from the verify callback's records — the peer chain is
 * already gone once the handshake has failed. */
static void scr_tls_verify_msg(ScrTlsSock *t, char *out, size_t n) {
  if (t->vrfy_expired) {
    snprintf(out, n, "certificate has expired");
    return;
  }
  /* Node appends the --use-system-ca hint for exactly these two codes
   * (src/crypto/crypto_common.cc: DEPTH_ZERO_SELF_SIGNED_CERT and
   * UNABLE_TO_VERIFY_LEAF_SIGNATURE) — and NOT for the in-chain one. */
  static const char hint[] =
      "; if the root CA is installed locally, try running Node.js with --use-system-ca";
  if (t->vrfy_leaf_self) {
    snprintf(out, n, "self-signed certificate%s", hint);
    return;
  }
  if (t->vrfy_chain_self) {
    snprintf(out, n, "self-signed certificate in certificate chain");
    return;
  }
  /* the identity check only decides on a TRUSTED chain — Node's order
   * (checkServerIdentity runs after verification succeeds) */
  if (t->vrfy_cn_mismatch &&
      (mbedtls_ssl_get_verify_result(&t->ssl) & MBEDTLS_X509_BADCERT_NOT_TRUSTED) == 0) {
    snprintf(out, n, "Hostname/IP does not match certificate's altnames");
    return;
  }
  snprintf(out, n, "unable to verify the first certificate%s", hint);
}

/* ── the SNI pre-parse ────────────────────────────────────────────────
 * mbedTLS's f_sni must answer synchronously from inside the handshake,
 * but the JS SNICallback is asynchronous (per-hostname certs generate on
 * demand — the portless flow). So a callback-carrying server resolves
 * the name FIRST: it buffers the raw ClientHello flight off the socket,
 * parses the server_name extension itself, parks the handshake while the
 * JS callback decides, then replays the buffered bytes into the bio and
 * runs the real handshake — whose f_sni serves the answered context. */

/* The socket whose handshake this unit is driving — f_sni's route back
 * to the answered context (single-threaded runtime; set around
 * mbedtls_ssl_handshake). */
static ScrTlsSock *scr_tls_current = NULL;

/* Defined with the other transport ops below; the answer path needs the
 * table's identity to re-find its engine from the boxed socket. */
static const ScrNetTransportOps SCR_TLS_OPS;

static int scr_tls_f_sni(void *p, mbedtls_ssl_context *ssl, const unsigned char *name,
                          size_t len) {
  (void)p; (void)name; (void)len;
  ScrTlsSock *t = scr_tls_current;
  if (t != NULL && t->sni_ctx != NULL) {
    return mbedtls_ssl_set_hs_own_cert(ssl, &t->sni_ctx->cert, &t->sni_ctx->pk);
  }
  return 0; /* default cert (no answer / cb passed no context) */
}

/* The ClientHello body walk (past the 4-byte handshake header): version +
 * random, session id, cipher suites, compression, then the extension list
 * — server_name (type 0) holds one host_name (type 0) entry. Answers 1
 * with `out` set, 2 for a well-formed hello without SNI or anything
 * malformed (the real handshake will judge it). */
static int scr_tls_parse_ch_body(const unsigned char *b, size_t n, char *out, size_t out_cap) {
  size_t i = 34; /* version(2) + random(32) */
  if (i + 1 > n) return 2;
  i += 1 + b[i]; /* session id: length byte + body */
  if (i + 2 > n) return 2;
  size_t cs = ((size_t)b[i] << 8) | b[i + 1];
  i += 2 + cs;
  if (i + 1 > n) return 2;
  i += 1 + b[i];
  if (i + 2 > n) return 2;
  size_t ext_total = ((size_t)b[i] << 8) | b[i + 1];
  i += 2;
  size_t end = i + ext_total <= n ? i + ext_total : n;
  while (i + 4 <= end) {
    size_t et = ((size_t)b[i] << 8) | b[i + 1];
    size_t el = ((size_t)b[i + 2] << 8) | b[i + 3];
    i += 4;
    if (i + el > end) return 2;
    if (et == 0) {
      /* server_name: list length(2), then entry type(1) + length(2) + name */
      if (el < 5 || b[i + 2] != 0) return 2;
      size_t nl = ((size_t)b[i + 3] << 8) | b[i + 4];
      if (nl == 0 || nl + 5 > el || nl + 1 > out_cap) return 2;
      memcpy(out, b + i + 5, nl);
      out[nl] = 0;
      return 1;
    }
    i += el;
  }
  return 2;
}

/* Reassemble the handshake stream from the raw record flight and look for
 * the server_name extension. 0 = need more bytes; 1 = found (out set);
 * 2 = no SNI / not parseable (serve the default cert). */
static int scr_tls_parse_sni(const unsigned char *buf, size_t len, char *out, size_t out_cap) {
  unsigned char *hs = NULL;
  size_t hs_len = 0, hs_cap = 0;
  size_t off = 0;
  for (;;) {
    if (off + 5 > len) { free(hs); return 0; }
    if (buf[off] != 0x16) { free(hs); return 2; } /* not a handshake record */
    size_t rlen = ((size_t)buf[off + 3] << 8) | buf[off + 4];
    if (rlen == 0 || rlen > 16640) { free(hs); return 2; }
    if (off + 5 + rlen > len) { free(hs); return 0; }
    if (hs_len + rlen > hs_cap) {
      hs_cap = hs_cap ? hs_cap * 2 : 4096;
      while (hs_cap < hs_len + rlen) hs_cap *= 2;
      hs = realloc(hs, hs_cap);
      if (!hs) scr_tls_oom();
    }
    memcpy(hs + hs_len, buf + off + 5, rlen);
    hs_len += rlen;
    off += 5 + rlen;
    if (hs_len >= 4) {
      if (hs[0] != 0x01) { free(hs); return 2; } /* not a ClientHello */
      size_t chlen = ((size_t)hs[1] << 16) | ((size_t)hs[2] << 8) | hs[3];
      if (chlen > 131072) { free(hs); return 2; }
      if (hs_len >= 4 + chlen) {
        int r = scr_tls_parse_ch_body(hs + 4, chlen, out, out_cap);
        free(hs);
        return r;
      }
    }
  }
}

/* Hand the buffered flight back: the bio reads it ahead of the kernel. */
static void scr_tls_sni_replay(ScrTlsSock *t) {
  if (t->hello_len > 0) {
    scr_net_sock_replay(t->sock, (const char *)t->hello, t->hello_len);
  }
  free(t->hello);
  t->hello = NULL;
  t->hello_len = t->hello_cap = 0;
}

/* The COLLECT step: buffer what the socket has, decide, invoke the JS
 * callback. Answers like the transport handshake contract: 1 = proceed
 * to the real handshake, 0 = parked (more bytes, or the callback is
 * deciding), -1 = the socket died (already torn down). */
static int scr_tls_sni_collect(ScrTlsSock *t) {
  char servername[256];
  for (;;) {
    if (t->hello_len > 0) {
      int r = scr_tls_parse_sni(t->hello, t->hello_len, servername, sizeof servername);
      if (r == 2 || t->hello_len > 65536) {
        /* no SNI (or unparseable): skip the callback, serve the default
         * pair — Node's SNICallback never fires without a server_name */
        t->sni_state = SCR_SNI_DONE;
        scr_tls_sni_replay(t);
        return 1;
      }
      if (r == 1) {
        t->sni_state = SCR_SNI_WAIT;
        ScrClosure *cb = scr_closure_retain(t->srv->sni_cb);
        ScrClosure *ans = scr_closure_new(t->srv->sni_answer_fn, 1);
        ScrBox *box = scr_box_new_obj(scr_net_sock_retain_v, scr_net_sock_release_v, NULL);
        scr_box_set_ref(box, scr_net_sock_retain(t->sock));
        ans->caps[0] = box;
        ScrStr *name = scr_str_new(servername, strlen(servername));
        /* the callback owns its +1 params per the universal convention */
        ((void (*)(ScrClosure *, ScrStr *, ScrClosure *))cb->fn)(cb, name, ans);
        scr_closure_release(cb);
        if (scr_net_sock_fd(t->sock) < 0) return -1; /* a sync cb(err) tore it down */
        if (t->sni_state == SCR_SNI_WAIT) return 0;   /* asynchronous answer */
        return 1; /* a synchronous answer already replayed the flight */
      }
    }
    /* need more bytes: buffered (unshifted demux peeks) first, then the fd */
    if (t->hello_len + 4096 > t->hello_cap) {
      t->hello_cap = t->hello_cap ? t->hello_cap * 2 : 8192;
      t->hello = realloc(t->hello, t->hello_cap);
      if (!t->hello) scr_tls_oom();
    }
    size_t room = t->hello_cap - t->hello_len;
    size_t took = scr_net_sock_take_buffered(t->sock, (char *)t->hello + t->hello_len, room);
    if (took == 0) {
      int fd = scr_net_sock_fd(t->sock);
      if (fd < 0) return -1;
      ssize_t n = read(fd, t->hello + t->hello_len, room);
      if (n < 0) {
        if (errno == EINTR) continue;
        if (errno == EAGAIN || errno == EWOULDBLOCK) return 0; /* readiness re-drives */
        scr_net_sock_transport_error(t->sock, NULL);
        return -1;
      }
      if (n == 0) { /* the peer died mid-hello: silent server-side teardown */
        scr_net_sock_transport_error(t->sock, NULL);
        return -1;
      }
      took = (size_t)n;
    }
    t->hello_len += took;
  }
}

/* The answer closure's runtime half (its fn is the emitted per-shape
 * thunk; caps[0] boxes the socket). Late, repeated, or dead-socket
 * answers are ignored — the first answer decides, like Node. */
void scr_tls_sni_answer(ScrClosure *self, bool has_err, ScrSecureCtx *ctx /*moves, nullable*/) {
  /* an identity-less context (no cert/key) cannot answer a handshake: the socket takes the error path */
  if (ctx != NULL && !(ctx->has_cert && ctx->has_key)) has_err = true;
  ScrNetSocket *sock = (ScrNetSocket *)scr_box_get_ref(self->caps[0]);
  ScrTlsSock *t =
      sock != NULL ? (ScrTlsSock *)scr_net_sock_transport_ctx_for(sock, &SCR_TLS_OPS) : NULL;
  if (t == NULL || t->sni_state != SCR_SNI_WAIT) {
    scr_secure_ctx_release(ctx);
    scr_net_sock_release(sock);
    return;
  }
  t->sni_state = SCR_SNI_DONE;
  if (has_err) {
    /* Node destroys the socket ('tlsClientError'; silent with no
     * listener — what portless observes). */
    scr_secure_ctx_release(ctx);
    free(t->hello);
    t->hello = NULL;
    t->hello_len = t->hello_cap = 0;
    scr_net_sock_transport_error(t->sock, NULL);
    scr_net_sock_release(sock);
    return;
  }
  t->sni_ctx = ctx; /* moves; NULL = the default pair */
  scr_tls_sni_replay(t);
  /* An asynchronous answer must re-drive the parked handshake itself —
   * the client is waiting for the ServerHello, so no readiness comes. A
   * SYNCHRONOUS answer (cache hit) returns into the running collect
   * step, which proceeds directly. */
  if (!t->in_handshake) scr_net_sock_transport_resume(sock);
  scr_net_sock_release(sock);
}

/* ── tls.checkServerIdentity (Node v24.15 lib/tls.js, algorithm-exact) ──
 * The identity check Node runs once the chain verified (or as the user's
 * checkServerIdentity option). Mirrors Node's helpers: unfqdn (one
 * trailing dot), splitHost (ASCII A-Z lowered, split on '.'), check()
 * with RFC 6125 single-label wildcards, the JSON-literal walk of
 * subjectaltname (splitEscapedAltNames), and canonicalizeIP. */

/* Owned-string builders for the identity path. scr_dyn_new_str and
 * scr_error_new both RETAIN their string argument, so the scr_str_new
 * reference is released here, once the wrapper holds its own. */
static ScrDyn *scr_id_dyn_str(const char *s, size_t n) {
  ScrStr *t = scr_str_new(s, n);
  ScrDyn *d = scr_dyn_new_str(t);
  scr_str_release(t);
  return d;
}

static ScrError *scr_id_err_new(const char *s, size_t n) {
  ScrStr *t = scr_str_new(s, n);
  ScrError *e = scr_error_new(SCR_ERR_ERROR, t);
  scr_str_release(t);
  return e;
}

typedef struct { const char *p; size_t n; } ScrIdSpan;
typedef struct { char *buf; ScrIdSpan *lab; size_t nlab; } ScrIdLabels;

static void scr_id_labels_free(ScrIdLabels *L) {
  free(L->buf);
  free(L->lab);
  L->buf = NULL;
  L->lab = NULL;
  L->nlab = 0;
}

static void scr_id_split_host(ScrIdLabels *L, const char *s, size_t n) {
  if (n > 0 && s[n - 1] == '.') n--;
  L->buf = malloc(n + 1);
  if (!L->buf) scr_tls_oom();
  size_t nlab = 1;
  for (size_t i = 0; i < n; i++) {
    char c = s[i];
    if (c >= 'A' && c <= 'Z') c = (char)(c + 32);
    L->buf[i] = c;
    if (c == '.') nlab++;
  }
  L->buf[n] = '\0';
  L->lab = malloc(nlab * sizeof *L->lab);
  if (!L->lab) scr_tls_oom();
  L->nlab = nlab;
  size_t k = 0, start = 0;
  for (size_t i = 0; i <= n; i++) {
    if (i == n || L->buf[i] == '.') {
      L->lab[k].p = L->buf + start;
      L->lab[k].n = i - start;
      k++;
      start = i + 1;
    }
  }
}

static bool scr_id_span_eq(ScrIdSpan a, ScrIdSpan b) {
  return a.n == b.n && (a.n == 0 || memcmp(a.p, b.p, a.n) == 0);
}

/* Node's check(hostParts, pattern, true). */
static bool scr_id_check(const ScrIdLabels *h, const char *pat, size_t pn) {
  if (pn == 0) return false;
  ScrIdLabels p;
  scr_id_split_host(&p, pat, pn);
  bool ok = false;
  do {
    if (h->nlab != p.nlab) break;
    bool bad = false;
    for (size_t i = 0; i < p.nlab && !bad; i++) {
      if (p.lab[i].n == 0) bad = true;
      for (size_t j = 0; j < p.lab[i].n && !bad; j++) {
        unsigned char c = (unsigned char)p.lab[i].p[j];
        if (c < 0x21 || c > 0x7f) bad = true;
      }
    }
    if (bad) break;
    bool tail = true;
    for (size_t i = h->nlab - 1; i > 0; i--) {
      if (!scr_id_span_eq(h->lab[i], p.lab[i])) {
        tail = false;
        break;
      }
    }
    if (!tail) break;
    ScrIdSpan hs = h->lab[0], ps = p.lab[0];
    size_t stars = 0, star_at = 0;
    for (size_t j = 0; j < ps.n; j++) {
      if (ps.p[j] == '*') {
        if (stars == 0) star_at = j;
        stars++;
      }
    }
    bool has_xn = false;
    for (size_t j = 0; j + 4 <= ps.n && !has_xn; j++) has_xn = memcmp(ps.p + j, "xn--", 4) == 0;
    if (stars == 0 || has_xn) {
      ok = scr_id_span_eq(hs, ps);
      break;
    }
    if (stars > 1) break;     /* more than one wildcard is always wrong */
    if (p.nlab <= 2) break;   /* *.tld wildcards are not allowed */
    size_t pre = star_at, suf = ps.n - star_at - 1;
    if (pre + suf > hs.n) break;
    if (memcmp(hs.p, ps.p, pre) != 0) break;
    if (memcmp(hs.p + hs.n - suf, ps.p + star_at + 1, suf) != 0) break;
    ok = true;
  } while (0);
  scr_id_labels_free(&p);
  return ok;
}

/* canonicalizeIP: the canonical text of an IPv4/IPv6 literal, or false. */
static bool scr_id_canon_ip(const char *s, size_t n, char *out, size_t cap) {
  char tmp[80];
  if (n == 0 || n >= sizeof tmp) return false;
  memcpy(tmp, s, n);
  tmp[n] = '\0';
  struct in_addr a4;
  struct in6_addr a6;
  if (inet_pton(AF_INET, tmp, &a4) == 1) return inet_ntop(AF_INET, &a4, out, (socklen_t)cap) != NULL;
  if (inet_pton(AF_INET6, tmp, &a6) == 1) return inet_ntop(AF_INET6, &a6, out, (socklen_t)cap) != NULL;
  return false;
}

typedef struct { char *s; size_t n, cap; } ScrIdBuf;
static void scr_id_buf_add(ScrIdBuf *b, const char *s, size_t n) {
  if (b->n + n + 1 > b->cap) {
    size_t cap = (b->n + n + 1) * 2 + 16;
    char *grown = realloc(b->s, cap);
    if (!grown) scr_tls_oom();
    b->s = grown;
    b->cap = cap;
  }
  if (n > 0) memcpy(b->s + b->n, s, n);
  b->n += n;
  b->s[b->n] = '\0';
}

static void scr_id_buf_lit(ScrIdBuf *b, const char *s) { scr_id_buf_add(b, s, strlen(s)); }

typedef struct { ScrIdBuf *v; size_t n, cap; } ScrIdList;
static void scr_id_list_push(ScrIdList *l, ScrIdBuf b) {
  if (l->n == l->cap) {
    size_t cap = l->cap ? l->cap * 2 : 8;
    ScrIdBuf *grown = realloc(l->v, cap * sizeof *grown);
    if (!grown) scr_tls_oom();
    l->v = grown;
    l->cap = cap;
  }
  l->v[l->n++] = b;
}
static void scr_id_list_free(ScrIdList *l) {
  for (size_t i = 0; i < l->n; i++) free(l->v[i].s);
  free(l->v);
  l->v = NULL;
  l->n = l->cap = 0;
}

/* The length of the JSON string literal at s (ECMA-404, exactly the
 * pattern Node's splitEscapedAltNames matches); 0 when none. */
static size_t scr_id_json_str_len(const char *s, size_t n) {
  if (n == 0 || s[0] != '"') return 0;
  size_t i = 1;
  while (i < n) {
    unsigned char c = (unsigned char)s[i];
    if (c == '"') return i + 1;
    if (c < 0x20) return 0;
    if (c != '\\') {
      i++;
      continue;
    }
    if (i + 1 >= n) return 0;
    char e = s[i + 1];
    if (e == 'u') {
      if (i + 6 > n) return 0;
      for (size_t k = i + 2; k < i + 6; k++) {
        if (!isxdigit((unsigned char)s[k])) return 0;
      }
      i += 6;
    } else if (e == '"' || e == '\\' || e == '/' || e == 'b' || e == 'f' || e == 'n' || e == 'r' || e == 't') {
      i += 2;
    } else {
      return 0;
    }
  }
  return 0;
}

static void scr_id_put_utf8(ScrIdBuf *b, unsigned cp) {
  char o[4];
  size_t k;
  if (cp < 0x80) {
    o[0] = (char)cp;
    k = 1;
  } else if (cp < 0x800) {
    o[0] = (char)(0xC0 | (cp >> 6));
    o[1] = (char)(0x80 | (cp & 0x3F));
    k = 2;
  } else if (cp < 0x10000) {
    o[0] = (char)(0xE0 | (cp >> 12));
    o[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
    o[2] = (char)(0x80 | (cp & 0x3F));
    k = 3;
  } else {
    o[0] = (char)(0xF0 | (cp >> 18));
    o[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
    o[2] = (char)(0x80 | ((cp >> 6) & 0x3F));
    o[3] = (char)(0x80 | (cp & 0x3F));
    k = 4;
  }
  scr_id_buf_add(b, o, k);
}

static int scr_id_hex4(const char *s) {
  int v = 0;
  for (int k = 0; k < 4; k++) {
    char c = s[k];
    int d = (c >= '0' && c <= '9') ? c - '0' : (c >= 'a' && c <= 'f') ? c - 'a' + 10 : c - 'A' + 10;
    v = v * 16 + d;
  }
  return v;
}

/* JSON.parse of a validated literal's contents (the quotes excluded). */
static void scr_id_json_decode(ScrIdBuf *b, const char *s, size_t n) {
  for (size_t i = 0; i < n;) {
    if (s[i] != '\\') {
      scr_id_buf_add(b, s + i, 1);
      i++;
      continue;
    }
    char e = s[i + 1];
    if (e == 'u') {
      unsigned cp = (unsigned)scr_id_hex4(s + i + 2);
      i += 6;
      if (cp >= 0xD800 && cp <= 0xDBFF && i + 6 <= n && s[i] == '\\' && s[i + 1] == 'u') {
        unsigned lo = (unsigned)scr_id_hex4(s + i + 2);
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          i += 6;
        }
      }
      scr_id_put_utf8(b, cp);
      continue;
    }
    char out = e == 'b' ? '\b' : e == 'f' ? '\f' : e == 'n' ? '\n' : e == 'r' ? '\r' : e == 't' ? '\t' : e;
    scr_id_buf_add(b, &out, 1);
    i += 2;
  }
}

/* Node's splitEscapedAltNames (used when the string holds a '"'). False on
 * a malformed literal (Node's ERR_TLS_CERT_ALTNAME_FORMAT). */
static bool scr_id_split_escaped(const char *a, size_t n, ScrIdList *out) {
  ScrIdBuf tok = {0};
  size_t off = 0;
  while (off < n) {
    size_t sep = n, quo = n;
    for (size_t k = off; k < n; k++) {
      if (a[k] == ',') {
        sep = k;
        break;
      }
    }
    for (size_t k = off; k < n; k++) {
      if (a[k] == '"') {
        quo = k;
        break;
      }
    }
    if (quo < n && (sep == n || quo < sep)) {
      scr_id_buf_add(&tok, a + off, quo - off);
      size_t m = scr_id_json_str_len(a + quo, n - quo);
      if (m == 0) {
        free(tok.s);
        return false;
      }
      scr_id_json_decode(&tok, a + quo + 1, m - 2);
      off = quo + m;
    } else if (sep < n) {
      scr_id_buf_add(&tok, a + off, sep - off);
      scr_id_list_push(out, tok);
      tok = (ScrIdBuf){0};
      off = sep + 2;
    } else {
      scr_id_buf_add(&tok, a + off, n - off);
      off = n;
    }
  }
  scr_id_list_push(out, tok);
  return true;
}

/* Node's altNames.split(', ') (the string holds no '"'). */
static void scr_id_split_plain(const char *a, size_t n, ScrIdList *out) {
  size_t start = 0;
  for (size_t k = 0; k + 1 < n; k++) {
    if (a[k] == ',' && a[k + 1] == ' ') {
      ScrIdBuf t = {0};
      scr_id_buf_add(&t, a + start, k - start);
      scr_id_list_push(out, t);
      start = k + 2;
      k++;
    }
  }
  ScrIdBuf t = {0};
  scr_id_buf_add(&t, a + start, n - start);
  scr_id_list_push(out, t);
}

/* The verdict: the Node reason (malloc'd) when the identity does NOT match,
 * NULL when it does. `alt`/`altn` is subjectaltname (NULL when absent).
 * `cns` holds subject.CN: one entry for a string CN, every entry of an
 * array CN (Node's Array.isArray arm), none when CN is absent or falsy.
 * `has_cn` is Node's truthy test on subject?.CN. */
static char *scr_id_reason(const char *host, size_t hn, const char *alt, size_t altn,
                           bool has_cn, const ScrIdList *cns, bool *fmt_err) {
  ScrIdList entries = {0}, dns = {0}, ips = {0};
  *fmt_err = false;
  if (alt != NULL && altn > 0) {
    bool quoted = false;
    for (size_t k = 0; k < altn && !quoted; k++) quoted = alt[k] == '"';
    if (quoted) {
      if (!scr_id_split_escaped(alt, altn, &entries)) {
        scr_id_list_free(&entries);
        *fmt_err = true;
        return NULL;
      }
    } else {
      scr_id_split_plain(alt, altn, &entries);
    }
    for (size_t i = 0; i < entries.n; i++) {
      ScrIdBuf *e = &entries.v[i];
      if (e->n >= 4 && memcmp(e->s, "DNS:", 4) == 0) {
        ScrIdBuf d = {0};
        scr_id_buf_add(&d, e->s + 4, e->n - 4);
        scr_id_list_push(&dns, d);
      } else if (e->n >= 11 && memcmp(e->s, "IP Address:", 11) == 0) {
        /* an unparseable SAN address canonicalizes to undefined: it never matches */
        char canon[80];
        ScrIdBuf d = {0};
        if (scr_id_canon_ip(e->s + 11, e->n - 11, canon, sizeof canon)) scr_id_buf_add(&d, canon, strlen(canon));
        scr_id_list_push(&ips, d);
      }
    }
  }
  /* unfqdn: Node strips one trailing dot before every use, messages included */
  size_t hostn = hn > 0 && host[hn - 1] == '.' ? hn - 1 : hn;
  char *reason = NULL;
  bool valid = false;
  ScrIdLabels h;
  scr_id_split_host(&h, host, hn);
  char lit[80];
  bool is_ip = false;
  if (hostn < sizeof lit) {
    memcpy(lit, host, hostn);
    lit[hostn] = '\0';
    struct in_addr a4;
    struct in6_addr a6;
    is_ip = inet_pton(AF_INET, lit, &a4) == 1 || inet_pton(AF_INET6, lit, &a6) == 1;
  }
  if (is_ip) {
    char canon[80];
    if (scr_id_canon_ip(host, hostn, canon, sizeof canon)) {
      for (size_t i = 0; i < ips.n && !valid; i++) {
        valid = ips.v[i].n == strlen(canon) && memcmp(ips.v[i].s, canon, ips.v[i].n) == 0;
      }
    }
    if (!valid) {
      ScrIdBuf r = {0};
      scr_id_buf_lit(&r, "IP: ");
      scr_id_buf_add(&r, host, hostn);
      scr_id_buf_lit(&r, " is not in the cert's list: ");
      for (size_t i = 0; i < ips.n; i++) {
        if (i > 0) scr_id_buf_lit(&r, ", ");
        scr_id_buf_add(&r, ips.v[i].s, ips.v[i].n);
      }
      reason = r.s;
    }
  } else if (dns.n > 0 || has_cn) {
    if (dns.n > 0) {
      for (size_t i = 0; i < dns.n && !valid; i++) valid = scr_id_check(&h, dns.v[i].s, dns.v[i].n);
      if (!valid) {
        ScrIdBuf r = {0};
        scr_id_buf_lit(&r, "Host: ");
        scr_id_buf_add(&r, host, hostn);
        scr_id_buf_lit(&r, ". is not in the cert's altnames: ");
        scr_id_buf_add(&r, alt, altn);
        reason = r.s;
      }
    } else {
      for (size_t i = 0; i < cns->n && !valid; i++) valid = scr_id_check(&h, cns->v[i].s, cns->v[i].n);
      if (!valid) {
        ScrIdBuf r = {0};
        scr_id_buf_lit(&r, "Host: ");
        scr_id_buf_add(&r, host, hostn);
        scr_id_buf_lit(&r, ". is not cert's CN: ");
        for (size_t i = 0; i < cns->n; i++) {
          if (i > 0) scr_id_buf_lit(&r, ",");
          scr_id_buf_add(&r, cns->v[i].s, cns->v[i].n);
        }
        reason = r.s;
      }
    }
  } else {
    reason = strdup("Cert does not contain a DNS name");
    if (!reason) scr_tls_oom();
  }
  scr_id_labels_free(&h);
  scr_id_list_free(&entries);
  scr_id_list_free(&dns);
  scr_id_list_free(&ips);
  if (valid) {
    free(reason);
    return NULL;
  }
  return reason;
}

/* JS truthiness over the dyn kinds (the callback's verdict: undefined and
 * null are accepted, like every falsy value Node's `if (verifyError)` takes). */
static bool scr_id_truthy(const ScrDyn *v) {
  switch (v->kind) {
    case SCR_DYN_UNDEF:
    case SCR_DYN_NULL:
      return false;
    case SCR_DYN_BOOL:
      return v->v.b;
    case SCR_DYN_NUM:
      return v->v.num != 0 && !isnan(v->v.num);
    case SCR_DYN_STR:
      return v->v.str->len > 0;
    default:
      return true;
  }
}

/* The subject.CN values and subjectaltname of a checked-dynamic cert. Node
 * reads `cert.subject` / `cert.subjectaltname` directly (a non-object cert
 * answers nothing here). Borrows `cert`; the CN strings are copied. */
static void scr_id_cert_fields(const ScrDyn *cert, ScrIdList *cns, const char **alt, size_t *altn,
                               bool *has_cn) {
  *alt = NULL;
  *altn = 0;
  *has_cn = false;
  if (cert == NULL || cert->kind != SCR_DYN_OBJ) return;
  const ScrDyn *a = scr_dyn_obj_get(cert, "subjectaltname", 14);
  if (a != NULL && a->kind == SCR_DYN_STR && a->v.str->len > 0) {
    *alt = a->v.str->data;
    *altn = a->v.str->len;
  }
  const ScrDyn *subj = scr_dyn_obj_get(cert, "subject", 7);
  const ScrDyn *cn = subj != NULL && subj->kind == SCR_DYN_OBJ ? scr_dyn_obj_get(subj, "CN", 2) : NULL;
  if (cn == NULL || !scr_id_truthy(cn)) return;
  *has_cn = true;
  if (cn->kind == SCR_DYN_ARR) {
    double n = scr_dyn_arr_len(cn);
    for (double i = 0; i < n; i++) {
      ScrDyn *el = scr_dyn_arr_at(cn, i);
      ScrIdBuf b = {0};
      if (el->kind == SCR_DYN_STR) scr_id_buf_add(&b, el->v.str->data, el->v.str->len);
      scr_dyn_release(el);
      scr_id_list_push(cns, b);
    }
  } else if (cn->kind == SCR_DYN_STR) {
    ScrIdBuf b = {0};
    scr_id_buf_add(&b, cn->v.str->data, cn->v.str->len);
    scr_id_list_push(cns, b);
  }
}

/* ── the peer certificate (getPeerCertificate) ──────────────────────── */

/* One DER TLV at *p (bounded by end): tag, content, length. Short and long
 * lengths; high-tag-number forms are refused (no X.509 member uses one). */
static bool scr_der_tlv(const unsigned char **p, const unsigned char *end, unsigned *tag,
                        const unsigned char **v, size_t *vlen) {
  if (*p >= end) return false;
  unsigned t = *(*p)++;
  if ((t & 0x1f) == 0x1f || *p >= end) return false;
  size_t len = *(*p)++;
  if (len & 0x80) {
    size_t nb = len & 0x7f;
    if (nb == 0 || nb > sizeof(size_t) || (size_t)(end - *p) < nb) return false;
    len = 0;
    for (size_t i = 0; i < nb; i++) len = (len << 8) | *(*p)++;
  }
  if ((size_t)(end - *p) < len) return false;
  *tag = t;
  *v = *p;
  *vlen = len;
  *p += len;
  return true;
}

/* The dotted text of an OID's DER content (1.2.840.113549.1.1.1). */
static void scr_der_oid_text(const unsigned char *v, size_t n, char out[128]) {
  size_t o = 0;
  unsigned long long acc = 0;
  bool first = true;
  out[0] = '\0';
  for (size_t i = 0; i < n && o < 100; i++) {
    acc = (acc << 7) | (v[i] & 0x7f);
    if (v[i] & 0x80) continue;
    if (first) {
      unsigned long long a = acc < 80 ? acc / 40 : 2, b = acc < 80 ? acc % 40 : acc - 80;
      o += (size_t)snprintf(out + o, 128 - o, "%llu.%llu", a, b);
      first = false;
    } else {
      o += (size_t)snprintf(out + o, 128 - o, ".%llu", acc);
    }
    acc = 0;
  }
}

/* The extnValue (DER content of the OCTET STRING) of the certificate's
 * extension `oid` (dotted), or false. v3_ext's content is the Extensions
 * SEQUENCE (mbedtls_x509_get_ext strips the [3] tag). */
static bool scr_tls_ext_value(const mbedtls_x509_crt *crt, const char *oid,
                              const unsigned char **val, size_t *vlen) {
  if (crt->v3_ext.p == NULL || crt->v3_ext.len == 0) return false;
  const unsigned char *p = crt->v3_ext.p, *end = p + crt->v3_ext.len;
  unsigned t;
  const unsigned char *v;
  size_t n;
  if (!scr_der_tlv(&p, end, &t, &v, &n)) return false;
  p = v;
  end = v + n;
  while (p < end) {
    const unsigned char *ev, *q, *qe, *oidv, *cv;
    size_t en, oidn, cn;
    unsigned et, ot, ct;
    if (!scr_der_tlv(&p, end, &et, &ev, &en)) return false;
    q = ev;
    qe = ev + en;
    if (!scr_der_tlv(&q, qe, &ot, &oidv, &oidn)) return false;
    char txt[128];
    scr_der_oid_text(oidv, oidn, txt);
    if (!scr_der_tlv(&q, qe, &ct, &cv, &cn)) return false;
    if (ct == 0x01) { /* critical BOOLEAN: the OCTET STRING follows */
      if (!scr_der_tlv(&q, qe, &ct, &cv, &cn)) return false;
    }
    if (strcmp(txt, oid) == 0) {
      *val = cv;
      *vlen = cn;
      return true;
    }
  }
  return false;
}

/* Uppercase hex of a byte run. `trim`: leading zero bytes dropped (a BIGNUM's
 * text, keeping one byte for zero). `colons`: "AB:CD" (a fingerprint). */
static ScrDyn *scr_tls_hex_dyn(const unsigned char *p, size_t n, bool trim, bool colons) {
  size_t s = 0;
  if (trim) while (s + 1 < n && p[s] == 0) s++;
  size_t cnt = n - s;
  size_t cap = cnt * 3 + 3;
  char *out = malloc(cap);
  if (!out) scr_tls_oom();
  size_t o = 0;
  static const char HEX[] = "0123456789ABCDEF";
  for (size_t i = 0; i < cnt; i++) {
    if (colons && i > 0) out[o++] = ':';
    out[o++] = HEX[p[s + i] >> 4];
    out[o++] = HEX[p[s + i] & 0x0f];
  }
  if (cnt == 0) out[o++] = '0', out[o++] = '0';
  ScrDyn *d = scr_id_dyn_str(out, o);
  free(out);
  return d;
}

/* An mbedTLS MPI as the minimal hex text (no leading zero digits). */
static ScrDyn *scr_tls_mpi_hex_dyn(const mbedtls_mpi *X, const char *prefix) {
  size_t cap = mbedtls_mpi_size(X) * 2 + 4;
  char *buf = malloc(cap);
  if (!buf) scr_tls_oom();
  size_t olen = 0;
  if (mbedtls_mpi_write_string(X, 16, buf, cap, &olen) != 0) {
    free(buf);
    return scr_dyn_new_null();
  }
  /* mbedTLS writes whole bytes (a leading "0" digit for 0x10001); Node's text
   * has no leading zero digit, so drop them (one digit stays). */
  size_t lead = 0;
  while (lead + 1 < olen - 1 && buf[lead] == '0') lead++;
  size_t digits = olen > 0 ? olen - 1 - lead : 0;
  size_t pl = strlen(prefix);
  char *full = malloc(pl + digits + 1);
  if (!full) scr_tls_oom();
  memcpy(full, prefix, pl);
  memcpy(full + pl, buf + lead, digits);
  ScrDyn *d = scr_id_dyn_str(full, pl + digits);
  free(full);
  free(buf);
  return d;
}

/* Node's validFrom / validTo text: "Oct 28 05:30:12 2026 GMT" (OpenSSL's
 * ASN1_TIME_print: the day is space-padded to two columns). */
static ScrDyn *scr_tls_time_dyn(const mbedtls_x509_time *t) {
  static const char *const MON[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
  char buf[64];
  int mi = t->mon >= 1 && t->mon <= 12 ? t->mon - 1 : 0;
  int n = snprintf(buf, sizeof buf, "%s %2d %02d:%02d:%02d %d GMT", MON[mi], t->day, t->hour,
                   t->min, t->sec, t->year);
  return scr_id_dyn_str(buf, (size_t)n);
}

/* The subject / issuer name as Node's object: short attribute names, repeated
 * attributes as arrays. */
static ScrDyn *scr_tls_name_dyn(const mbedtls_x509_name *head) {
  /* Node builds subject/issuer with a null prototype (util.inspect prints
   * [Object: null prototype]) */
  ScrDyn *obj = scr_dyn_new_obj_null_proto();
  for (const mbedtls_x509_name *n = head; n != NULL; n = n->next) {
    const char *sn = NULL;
    if (n->oid.p == NULL || n->val.p == NULL) continue;
    if (mbedtls_oid_get_attr_short_name(&n->oid, &sn) != 0 || sn == NULL) continue;
    size_t kl = strlen(sn);
    ScrDyn *v = scr_id_dyn_str((const char *)n->val.p, n->val.len);
    const ScrDyn *prev = scr_dyn_obj_get(obj, sn, kl);
    if (prev == NULL) {
      scr_dyn_obj_set(obj, sn, kl, v);
    } else if (prev->kind == SCR_DYN_ARR) {
      scr_dyn_arr_push((ScrDyn *)prev, v);
    } else {
      ScrDyn *arr = scr_dyn_new_arr();
      scr_dyn_arr_push(arr, scr_dyn_retain((ScrDyn *)prev));
      scr_dyn_arr_push(arr, v);
      scr_dyn_obj_set(obj, sn, kl, arr);
    }
  }
  return obj;
}

/* subjectaltname: OpenSSL's text ("DNS:a, IP Address:1.2.3.4"), or undefined. */
static ScrDyn *scr_tls_san_dyn(const mbedtls_x509_crt *crt) {
  ScrIdBuf san = {0};
  for (const mbedtls_x509_sequence *s = &crt->subject_alt_names; s != NULL; s = s->next) {
    if (s->buf.p == NULL) continue;
    int tag = s->buf.tag & MBEDTLS_ASN1_TAG_VALUE_MASK;
    ScrIdBuf one = {0};
    if (tag == MBEDTLS_X509_SAN_DNS_NAME) {
      scr_id_buf_lit(&one, "DNS:");
      scr_id_buf_add(&one, (const char *)s->buf.p, s->buf.len);
    } else if (tag == MBEDTLS_X509_SAN_IP_ADDRESS && (s->buf.len == 4 || s->buf.len == 16)) {
      /* OpenSSL's rendering: dotted quad for IPv4; IPv6 as eight uncompressed
       * upper-case groups ("2001:DB8:0:...:1") */
      char txt[80];
      const unsigned char *b = s->buf.p;
      if (s->buf.len == 4) {
        snprintf(txt, sizeof txt, "%u.%u.%u.%u", b[0], b[1], b[2], b[3]);
      } else {
        size_t o = 0;
        for (int g = 0; g < 8; g++) {
          o += (size_t)snprintf(txt + o, sizeof txt - o, "%s%X", g ? ":" : "", (b[2 * g] << 8) | b[2 * g + 1]);
        }
      }
      scr_id_buf_lit(&one, "IP Address:");
      scr_id_buf_add(&one, txt, strlen(txt));
    }
    if (one.n == 0) {
      free(one.s);
      continue;
    }
    if (san.n > 0) scr_id_buf_lit(&san, ", ");
    scr_id_buf_add(&san, one.s, one.n);
    free(one.s);
  }
  ScrDyn *out = san.n > 0 ? scr_id_dyn_str(san.s, san.n) : scr_dyn_undefined();
  free(san.s);
  return out;
}

/* infoAccess: { 'OCSP - URI': [...], 'CA Issuers - URI': [...] } from the
 * Authority Information Access extension (1.3.6.1.5.5.7.1.1), or undefined. */
static ScrDyn *scr_tls_info_access_dyn(const mbedtls_x509_crt *crt) {
  const unsigned char *v;
  size_t vn;
  if (!scr_tls_ext_value(crt, "1.3.6.1.5.5.7.1.1", &v, &vn)) return scr_dyn_undefined();
  const unsigned char *p = v, *end = v + vn;
  unsigned t;
  const unsigned char *sv;
  size_t sn;
  if (!scr_der_tlv(&p, end, &t, &sv, &sn)) return scr_dyn_undefined();
  ScrDyn *obj = scr_dyn_new_obj();
  p = sv;
  end = sv + sn;
  while (p < end) {
    const unsigned char *dv;
    size_t dn;
    unsigned dt;
    if (!scr_der_tlv(&p, end, &dt, &dv, &dn)) break;
    const unsigned char *q = dv, *qe = dv + dn, *mv, *uv;
    size_t mn, un;
    unsigned mt, ut;
    if (!scr_der_tlv(&q, qe, &mt, &mv, &mn)) break;
    if (!scr_der_tlv(&q, qe, &ut, &uv, &un)) break;
    if (ut != 0x86) continue; /* only a uniformResourceIdentifier location */
    char oid[128];
    scr_der_oid_text(mv, mn, oid);
    const char *name = strcmp(oid, "1.3.6.1.5.5.7.48.1") == 0 ? "OCSP"
                       : strcmp(oid, "1.3.6.1.5.5.7.48.2") == 0 ? "CA Issuers"
                                                                  : NULL;
    char key[160];
    int kn = snprintf(key, sizeof key, "%s - URI", name != NULL ? name : oid);
    ScrDyn *uri = scr_id_dyn_str((const char *)uv, un);
    const ScrDyn *prev = scr_dyn_obj_get(obj, key, (size_t)kn);
    if (prev == NULL) {
      ScrDyn *arr = scr_dyn_new_arr();
      scr_dyn_arr_push(arr, uri);
      scr_dyn_obj_set(obj, key, (size_t)kn, arr);
    } else {
      scr_dyn_arr_push((ScrDyn *)prev, uri);
    }
  }
  return obj;
}

/* ext_key_usage: the extended key usage OIDs (dotted), or undefined. */
static ScrDyn *scr_tls_eku_dyn(const mbedtls_x509_crt *crt) {
  const unsigned char *v;
  size_t vn;
  if (!scr_tls_ext_value(crt, "2.5.29.37", &v, &vn)) return scr_dyn_undefined();
  const unsigned char *p = v, *end = v + vn;
  unsigned t;
  const unsigned char *sv;
  size_t sn;
  if (!scr_der_tlv(&p, end, &t, &sv, &sn)) return scr_dyn_undefined();
  ScrDyn *arr = scr_dyn_new_arr();
  p = sv;
  end = sv + sn;
  while (p < end) {
    const unsigned char *ov;
    size_t on;
    unsigned ot;
    if (!scr_der_tlv(&p, end, &ot, &ov, &on)) break;
    char oid[128];
    scr_der_oid_text(ov, on, oid);
    scr_dyn_arr_push(arr, scr_id_dyn_str(oid, strlen(oid)));
  }
  return arr;
}

/* A Buffer of the given bytes (+1 dyn). */
static ScrDyn *scr_tls_buffer_dyn(const unsigned char *p, size_t n) {
  ScrBytes *b = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)n));
  if (n > 0) memcpy(b->data, p, n);
  ScrDyn *d = scr_dyn_new_buffer_copy(b);
  scr_bytes_release(b);
  return d;
}

/* The bit-string CONTENT (without the unused-bits octet) of an
 * SubjectPublicKeyInfo's key, or false. */
static bool scr_tls_spki_bits(const mbedtls_x509_crt *crt, const unsigned char **v, size_t *vn) {
  if (crt->pk_raw.p == NULL) return false;
  const unsigned char *p = crt->pk_raw.p, *end = p + crt->pk_raw.len;
  unsigned t;
  const unsigned char *sv;
  size_t sn;
  if (!scr_der_tlv(&p, end, &t, &sv, &sn)) return false;
  p = sv;
  end = sv + sn;
  const unsigned char *av;
  size_t an;
  if (!scr_der_tlv(&p, end, &t, &av, &an)) return false; /* AlgorithmIdentifier */
  const unsigned char *bv;
  size_t bn;
  if (!scr_der_tlv(&p, end, &t, &bv, &bn) || bn < 1) return false; /* BIT STRING */
  *v = bv + 1;
  *vn = bn - 1;
  return true;
}

/* The named-curve names of an EC key: OpenSSL's short name (asn1Curve) and
 * the NIST name (nistCurve, NIST curves only). NULL = not nameable here. */
static bool scr_tls_curve_names(mbedtls_ecp_group_id id, const char **asn1, const char **nist) {
  switch (id) {
    case MBEDTLS_ECP_DP_SECP256R1: *asn1 = "prime256v1"; *nist = "P-256"; return true;
    case MBEDTLS_ECP_DP_SECP384R1: *asn1 = "secp384r1"; *nist = "P-384"; return true;
    case MBEDTLS_ECP_DP_SECP521R1: *asn1 = "secp521r1"; *nist = "P-521"; return true;
    case MBEDTLS_ECP_DP_SECP256K1: *asn1 = "secp256k1"; *nist = NULL; return true;
    case MBEDTLS_ECP_DP_BP256R1: *asn1 = "brainpoolP256r1"; *nist = NULL; return true;
    case MBEDTLS_ECP_DP_BP384R1: *asn1 = "brainpoolP384r1"; *nist = NULL; return true;
    case MBEDTLS_ECP_DP_BP512R1: *asn1 = "brainpoolP512r1"; *nist = NULL; return true;
    default: *asn1 = NULL; *nist = NULL; return false;
  }
}

/* A certificate's fingerprint: the digest of its DER, uppercase, colon-separated. */
static ScrDyn *scr_tls_fp_dyn(const mbedtls_x509_crt *c, int bits) {
  unsigned char d[64];
  size_t n = 0;
  if (bits == 1) {
    (void)mbedtls_sha1(c->raw.p, c->raw.len, d);
    n = 20;
  } else if (bits == 256) {
    (void)mbedtls_sha256(c->raw.p, c->raw.len, d, 0);
    n = 32;
  } else {
    (void)mbedtls_sha512(c->raw.p, c->raw.len, d, 0);
    n = 64;
  }
  return scr_tls_hex_dyn(d, n, false, true);
}

/* The certificate object as Node's getPeerCertificate(true) presents it: the
 * 20 members, every one present (an absent member is undefined), in Node's
 * key order. `chain` is the peer chain's head; the issuer is found in it.
 * A self-issued certificate's issuerCertificate is the object itself: a
 * NON-OWNING back-reference (scr_dyn_obj_set_borrowed), so the object is
 * released without a cycle and reads reach it only through a live holder. */
static ScrDyn *scr_tls_cert_obj(const mbedtls_x509_crt *c, const mbedtls_x509_crt *chain, int depth) {
  ScrDyn *cert = scr_dyn_new_obj();
  scr_dyn_obj_set(cert, "subject", 7, scr_tls_name_dyn(&c->subject));
  scr_dyn_obj_set(cert, "issuer", 6, scr_tls_name_dyn(&c->issuer));
  scr_dyn_obj_set(cert, "subjectaltname", 14, scr_tls_san_dyn(c));
  scr_dyn_obj_set(cert, "infoAccess", 10, scr_tls_info_access_dyn(c));
  scr_dyn_obj_set(cert, "ca", 2, scr_dyn_new_bool(mbedtls_x509_crt_get_ca_istrue(c) == 1));

  mbedtls_pk_type_t kt = mbedtls_pk_get_type(&c->pk);
  const char *asn1 = NULL, *nist = NULL;
  if (kt == MBEDTLS_PK_RSA) {
    mbedtls_mpi N, E;
    mbedtls_mpi_init(&N);
    mbedtls_mpi_init(&E);
    if (mbedtls_rsa_export(mbedtls_pk_rsa(c->pk), &N, NULL, NULL, NULL, &E) == 0) {
      scr_dyn_obj_set(cert, "modulus", 7, scr_tls_mpi_hex_dyn(&N, ""));
      scr_dyn_obj_set(cert, "exponent", 8, scr_tls_mpi_hex_dyn(&E, "0x"));
    } else {
      scr_dyn_obj_set(cert, "modulus", 7, scr_dyn_undefined());
      scr_dyn_obj_set(cert, "exponent", 8, scr_dyn_undefined());
    }
    mbedtls_mpi_free(&N);
    mbedtls_mpi_free(&E);
    /* an RSA key's pubkey is the whole SubjectPublicKeyInfo */
    scr_dyn_obj_set(cert, "pubkey", 6, scr_tls_buffer_dyn(c->pk_raw.p, c->pk_raw.len));
  } else {
    scr_dyn_obj_set(cert, "modulus", 7, scr_dyn_undefined());
    scr_dyn_obj_set(cert, "exponent", 8, scr_dyn_undefined());
    const unsigned char *bv = NULL;
    size_t bn = 0;
    if (scr_tls_spki_bits(c, &bv, &bn)) {
      scr_dyn_obj_set(cert, "pubkey", 6, scr_tls_buffer_dyn(bv, bn));
    } else {
      scr_dyn_obj_set(cert, "pubkey", 6, scr_dyn_undefined());
    }
  }
  scr_dyn_obj_set(cert, "bits", 4, scr_dyn_new_num((double)mbedtls_pk_get_bitlen(&c->pk)));
  scr_dyn_obj_set(cert, "valid_from", 10, scr_tls_time_dyn(&c->valid_from));
  scr_dyn_obj_set(cert, "valid_to", 8, scr_tls_time_dyn(&c->valid_to));
  scr_dyn_obj_set(cert, "fingerprint", 11, scr_tls_fp_dyn(c, 1));
  scr_dyn_obj_set(cert, "fingerprint256", 14, scr_tls_fp_dyn(c, 256));
  scr_dyn_obj_set(cert, "fingerprint512", 14, scr_tls_fp_dyn(c, 512));
  scr_dyn_obj_set(cert, "ext_key_usage", 13, scr_tls_eku_dyn(c));
  scr_dyn_obj_set(cert, "serialNumber", 12, scr_tls_hex_dyn(c->serial.p, c->serial.len, true, false));
  scr_dyn_obj_set(cert, "raw", 3, scr_tls_buffer_dyn(c->raw.p, c->raw.len));
  if ((kt == MBEDTLS_PK_ECKEY || kt == MBEDTLS_PK_ECDSA) &&
      scr_tls_curve_names(mbedtls_pk_ec(c->pk)->grp.id, &asn1, &nist)) {
    scr_dyn_obj_set(cert, "asn1Curve", 9, scr_id_dyn_str(asn1, strlen(asn1)));
    scr_dyn_obj_set(cert, "nistCurve", 9,
                    nist != NULL ? scr_id_dyn_str(nist, strlen(nist)) : scr_dyn_undefined());
  } else {
    scr_dyn_obj_set(cert, "asn1Curve", 9, scr_dyn_undefined());
    scr_dyn_obj_set(cert, "nistCurve", 9, scr_dyn_undefined());
  }

  /* issuerCertificate: self-issued -> this object (non-owning); otherwise the
   * chain member whose subject is this certificate's issuer, built the same
   * way; otherwise undefined (the issuer was not presented). */
  bool self_issued = c->issuer_raw.len == c->subject_raw.len &&
                     memcmp(c->issuer_raw.p, c->subject_raw.p, c->subject_raw.len) == 0;
  if (self_issued) {
    scr_dyn_obj_set_borrowed(cert, "issuerCertificate", 17, cert);
  } else {
    const mbedtls_x509_crt *up = NULL;
    for (const mbedtls_x509_crt *n = chain; n != NULL && up == NULL; n = n->next) {
      if (n != c && n->subject_raw.len == c->issuer_raw.len &&
          memcmp(n->subject_raw.p, c->issuer_raw.p, c->issuer_raw.len) == 0) {
        up = n;
      }
    }
    if (up != NULL && depth < 8) {
      scr_dyn_obj_set(cert, "issuerCertificate", 17, scr_tls_cert_obj(up, chain, depth + 1));
    } else {
      scr_dyn_obj_set(cert, "issuerCertificate", 17, scr_dyn_undefined());
    }
  }
  return cert;
}

/* %Error with Node's ERR_TLS_CERT_ALTNAME_INVALID message and code. */
static ScrError *scr_id_error(const char *reason) {
  static const char pre[] = "Hostname/IP does not match certificate's altnames: ";
  size_t pl = sizeof pre - 1, rl = strlen(reason);
  char *msg = malloc(pl + rl + 1);
  if (!msg) scr_tls_oom();
  memcpy(msg, pre, pl);
  memcpy(msg + pl, reason, rl);
  ScrError *e = scr_id_err_new(msg, pl + rl);
  free(msg);
  scr_error_set_code(e, "ERR_TLS_CERT_ALTNAME_INVALID");
  return e;
}

/* The lowered tls.checkServerIdentity(hostname, cert) (both backends):
 * undefined when the identity matches, else Node's ERR_TLS_CERT_ALTNAME_INVALID
 * error object (message, code, reason, host, cert). `cert` is borrowed. */
ScrDyn *scr_tls_check_server_identity_dyn(const ScrStr *host, const ScrDyn *cert) {
  ScrIdList cns = {0};
  const char *alt = NULL;
  size_t altn = 0;
  bool has_cn = false;
  scr_id_cert_fields(cert, &cns, &alt, &altn, &has_cn);
  bool fmt = false;
  char *reason = scr_id_reason(host->data, host->len, alt, altn, has_cn, &cns, &fmt);
  scr_id_list_free(&cns);
  if (fmt) {
    scr_throw_error_msg_code(SCR_ERR_ERROR, "Invalid subject alternative name string", 36,
                             "ERR_TLS_CERT_ALTNAME_FORMAT");
    return NULL;
  }
  if (reason == NULL) return scr_dyn_retain(scr_dyn_undefined());
  ScrError *e = scr_id_error(reason);
  ScrDyn *d = scr_dyn_from_error(e);
  scr_error_release(e);
  size_t hn = host->len > 0 && host->data[host->len - 1] == '.' ? host->len - 1 : host->len;
  scr_dyn_obj_set(d, "reason", 6, scr_id_dyn_str(reason, strlen(reason)));
  scr_dyn_obj_set(d, "host", 4, scr_id_dyn_str(host->data, hn));
  scr_dyn_obj_set(d, "cert", 4, scr_dyn_retain((ScrDyn *)cert));
  free(reason);
  return d;
}

/* A fresh object holding the own enumerable members of `src`, in key order
 * (Node's Object.keys set: an error's code, reason, host and cert, never its
 * hidden message or name). */
static ScrDyn *scr_id_copy_own_enum(const ScrDyn *src) {
  ScrDyn *out = scr_dyn_new_obj();
  ScrDyn *keys = scr_dyn_obj_keys(src);
  double n = scr_dyn_arr_len(keys);
  for (double i = 0; i < n; i++) {
    ScrDyn *k = scr_dyn_arr_at(keys, i);
    if (k->kind == SCR_DYN_STR) {
      const ScrDyn *v = scr_dyn_obj_get(src, k->v.str->data, k->v.str->len);
      if (v != NULL) scr_dyn_obj_set(out, k->v.str->data, k->v.str->len, scr_dyn_retain((ScrDyn *)v));
    }
    scr_dyn_release(k);
  }
  scr_dyn_release(keys);
  return out;
}

/* Runs the user's checkServerIdentity (tls.connect's option) once the
 * handshake completed. Node calls it only when the chain VERIFIED and the
 * session was not resumed; a truthy answer is the verify error. False =
 * the connection failed (rejectUnauthorized) and the transport error is
 * set; with rejectUnauthorized:false the socket connects unauthorized. */
static bool scr_tls_ident_run(ScrTlsSock *t) {
  ScrTlsCli *cli = t->cli;
  if (cli == NULL || cli->identity == NULL || !cli->verify_recorded) return true;
  if (t->vrfy_expired || t->vrfy_leaf_self || t->vrfy_chain_self) return true;
  if (mbedtls_ssl_get_verify_result(&t->ssl) & MBEDTLS_X509_BADCERT_NOT_TRUSTED) return true;
  ScrDyn *args[2];
  args[0] = scr_id_dyn_str(cli->verify_name, strlen(cli->verify_name));
  const mbedtls_x509_crt *pc = mbedtls_ssl_get_peer_cert(&t->ssl);
  args[1] = pc != NULL ? scr_tls_cert_obj(pc, pc, 0) : scr_dyn_new_obj();
  ScrDyn *r = scr_dyn_call(cli->identity, args, 2, "checkServerIdentity");
  scr_dyn_release(args[0]);
  scr_dyn_release(args[1]);
  if (scr_exc_pending()) {
    scr_dyn_release(r);
    return false;
  }
  bool ok = true;
  if (r != NULL && scr_id_truthy(r)) {
    const ScrDyn *m = scr_dyn_err_read(r, "message", 7);
    const ScrDyn *c = scr_dyn_err_read(r, "code", 4);
    /* scr_error_new retains its message: the borrowed string needs no extra ref */
    ScrError *e = m != NULL && m->kind == SCR_DYN_STR ? scr_error_new(SCR_ERR_ERROR, m->v.str)
                                                      : scr_id_err_new("", 0);
    if (c != NULL && c->kind == SCR_DYN_STR) {
      char code[64];
      size_t cl = c->v.str->len < sizeof code - 1 ? c->v.str->len : sizeof code - 1;
      memcpy(code, c->v.str->data, cl);
      code[cl] = '\0';
      scr_error_set_code(e, code);
    }
    /* the error's own enumerable members (Node's code, reason, host, cert)
     * ride the ScrError as its expando props, so the listener reads them */
    if (r->kind == SCR_DYN_OBJ) e->props = scr_id_copy_own_enum(r);
    if (cli->reject) {
      scr_net_sock_transport_error_obj(t->sock, e);
      ok = false;
    } else {
      t->vrfy_cn_mismatch = true;
      scr_error_release(e);
    }
  }
  scr_dyn_release(r);
  return ok;
}

static int scr_tls_handshake(void *tctx) {
  ScrTlsSock *t = (ScrTlsSock *)tctx;
  if (t->sni_state == SCR_SNI_COLLECT) {
    t->in_handshake = true;
    int c = scr_tls_sni_collect(t);
    t->in_handshake = false;
    if (c <= 0) return c;
  }
  if (t->sni_state == SCR_SNI_WAIT) return 0; /* the callback is deciding */
  scr_tls_current = t;
  int r = mbedtls_ssl_handshake(&t->ssl);
  /* a ticket absorbed mid-handshake is not a handshake failure: keep going */
#if defined(MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET)
  while (r == MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET) r = mbedtls_ssl_handshake(&t->ssl);
#endif
  scr_tls_current = NULL;
  if (r == 0) {
    t->resumed = scr_tls_resumed(t);
    return scr_tls_ident_run(t) ? 1 : -1;
  }
  if (r == MBEDTLS_ERR_SSL_WANT_READ || r == MBEDTLS_ERR_SSL_WANT_WRITE) return 0;
  if (t->srv != NULL) {
    /* Node's server default: 'tlsClientError' with no listener destroys
     * the socket silently — exactly what portless (no listener) sees. */
    scr_net_sock_transport_error(t->sock, NULL);
    return -1;
  }
  char msg[160];
  if (r == MBEDTLS_ERR_X509_CERT_VERIFY_FAILED) {
    scr_tls_verify_msg(t, msg, sizeof msg);
  } else if (r == MBEDTLS_ERR_SSL_CONN_EOF || r == MBEDTLS_ERR_NET_CONN_RESET) {
    /* the peer died mid-handshake: the http layer's own premature-close
     * shape ('socket hang up') is Node's message — teardown silently at
     * this level and let the closed hook classify it */
    scr_net_sock_transport_error(t->sock, NULL);
    return -1;
  } else {
    /* non-verify handshake failures: honest but not Node's exact openssl
     * string (SEMANTICS.md divergence 55) */
    snprintf(msg, sizeof msg, "client TLS handshake failed");
  }
  scr_net_sock_transport_error(t->sock, msg);
  return -1;
}

static void scr_tls_on_established(void *tctx) {
  ScrTlsSock *t = (ScrTlsSock *)tctx;
  t->established = true;
  if (t->cli != NULL) scr_tls_fire_session(t); /* the 1.2 arm; 1.3 fires on ticket receipt */
  if (t->srv != NULL && t->srv->h2_conn != NULL) {
    /* the h2 secure server: dispatch on the NEGOTIATED protocol — the
     * h2 session attaches as the socket's native reader (it reads
     * plaintext through this transport, exactly like the https parser);
     * an http/1.1 answer routes to the wrapped parser when one exists;
     * a client that answered nothing tears down (Node parks it as
     * 'unknownProtocol' and destroys at the timeout — this surface
     * destroys now; SEMANTICS.md). */
    const char *alpn = mbedtls_ssl_get_alpn_protocol(&t->ssl);
    if (alpn != NULL && strcmp(alpn, "h2") == 0) {
      t->srv->h2_conn(t->srv->h2_ctx, t->sock);
    } else if (alpn != NULL && t->srv->inner_conn != NULL && strcmp(alpn, "http/1.1") == 0) {
      t->srv->inner_conn(t->srv->inner_ctx, t->sock);
    } else {
      scr_net_sock_transport_error(t->sock, NULL);
    }
    return;
  }
  if (t->srv != NULL && t->srv->inner_conn != NULL) {
    /* https: the http parser attaches now, over plaintext only */
    t->srv->inner_conn(t->srv->inner_ctx, t->sock);
  }
}

static bool scr_tls_pending(void *tctx) {
  ScrTlsSock *t = (ScrTlsSock *)tctx;
  return mbedtls_ssl_check_pending(&t->ssl) != 0 ||
         mbedtls_ssl_get_bytes_avail(&t->ssl) > 0;
}

static void scr_tls_shutdown_write(void *tctx) {
  ScrTlsSock *t = (ScrTlsSock *)tctx;
  if (t->notify_sent) return;
  t->notify_sent = true;
  (void)mbedtls_ssl_close_notify(&t->ssl); /* best effort; EAGAIN drops it */
}

static void scr_tls_free(void *tctx) {
  ScrTlsSock *t = (ScrTlsSock *)tctx;
  mbedtls_ssl_free(&t->ssl);
  if (t->srv) scr_tls_srv_release(t->srv);
  if (t->cli) scr_tls_cli_free(t->cli);
  scr_net_ls_drop(&t->session_ls);
  free(t->hello);
  scr_secure_ctx_release(t->sni_ctx);
  free(t);
}

static const ScrNetTransportOps SCR_TLS_OPS = {
  .xread = scr_tls_xread,
  .xwrite = scr_tls_xwrite,
  .handshake = scr_tls_handshake,
  .on_established = scr_tls_on_established,
  .pending = scr_tls_pending,
  .shutdown_write = scr_tls_shutdown_write,
  .free_fn = scr_tls_free,
};

/* ── the server surface ──────────────────────────────────────────────── */

/* The server's native-connection hook: one TLS engine per accepted
 * socket; the deferred 'connection' fires from the net pump once the
 * handshake stands. */
static void scr_tls_srv_on_conn(void *ctx, ScrNetSocket *sock) {
  ScrTlsSrv *srv = (ScrTlsSrv *)ctx;
  ScrTlsSock *t = calloc(1, sizeof *t);
  if (!t) scr_tls_oom();
  mbedtls_ssl_init(&t->ssl);
  if (mbedtls_ssl_setup(&t->ssl, &srv->conf) != 0) scr_tls_oom();
  t->sock = sock;
  t->srv = scr_tls_srv_retain(srv);
  if (srv->sni_cb != NULL) t->sni_state = SCR_SNI_COLLECT; /* pre-parse the hello */
  mbedtls_ssl_set_bio(&t->ssl, t, scr_tls_bio_send, scr_tls_bio_recv, NULL);
  scr_net_sock_set_transport(sock, &SCR_TLS_OPS, t);
}

ScrNetServer *scr_tls_create_server(const char *cert, size_t cert_len, const char *key,
                                     size_t key_len, ScrClosure *handler /*moves, nullable*/,
                                     ScrNetConnFn fn) {
  ScrTlsSrv *srv = scr_tls_srv_new(cert, cert_len, key, key_len, false);
  ScrNetServer *s = scr_net_create_server(handler, fn);
  scr_net_server_set_native_conn(s, &scr_tls_srv_on_conn, srv, &scr_tls_srv_release_v);
  scr_net_server_defer_connections(s); /* the handler is 'secureConnection' */
  return s;
}

ScrNetServer *scr_https_create_server(const char *cert, size_t cert_len, const char *key,
                                       size_t key_len, ScrClosure *handler /*moves*/,
                                       ScrHttpReqFn fn) {
  ScrNetServer *s = scr_http_create_server(handler, fn);
  ScrTlsSrv *srv = scr_tls_srv_new(cert, cert_len, key, key_len, true /* ALPN http/1.1 */);
  /* wrap the parser hook: TLS first, parser at establishment */
  scr_net_server_get_native_conn(s, &srv->inner_conn, &srv->inner_ctx, &srv->inner_ctx_free);
  scr_net_server_set_native_conn(s, &scr_tls_srv_on_conn, srv, &scr_tls_srv_release_v);
  scr_net_server_defer_connections(s);
  return s;
}

/* The SNI-callback form of the allowHTTP1 compatibility server: the same
 * handler-less https server, plus the pre-parse machinery (design note
 * atop the SNI section). A NULL sni_cb — the conditional spread's
 * undefined arm — is exactly scr_https_create_server(…, NULL, NULL). */
ScrNetServer *scr_https_create_server_sni(const char *cert, size_t cert_len, const char *key,
                                           size_t key_len, ScrClosure *sni_cb /*moves, nullable*/,
                                           void *answer_fn) {
  ScrNetServer *s = scr_http_create_server(NULL, NULL);
  ScrTlsSrv *srv = scr_tls_srv_new(cert, cert_len, key, key_len, true /* ALPN http/1.1 */);
  if (sni_cb != NULL) {
    srv->sni_cb = sni_cb; /* moves */
    srv->sni_answer_fn = answer_fn;
    mbedtls_ssl_conf_sni(&srv->conf, &scr_tls_f_sni, NULL);
  }
  scr_net_server_get_native_conn(s, &srv->inner_conn, &srv->inner_ctx, &srv->inner_ctx_free);
  scr_net_server_set_native_conn(s, &scr_tls_srv_on_conn, srv, &scr_tls_srv_release_v);
  scr_net_server_defer_connections(s);
  return s;
}

/* ── the client surface (https.request) ──────────────────────────────── */

static void scr_tls_cli_wrap(ScrNetSocket *sock, void *ctx) {
  ScrTlsCli *cli = (ScrTlsCli *)ctx;
  ScrTlsSock *t = calloc(1, sizeof *t);
  if (!t) scr_tls_oom();
  mbedtls_ssl_init(&t->ssl);
  if (mbedtls_ssl_setup(&t->ssl, &cli->conf) != 0) scr_tls_oom();
  if (cli->hostname != NULL) (void)mbedtls_ssl_set_hostname(&t->ssl, cli->hostname);
  if (cli->resume != NULL) (void)mbedtls_ssl_set_session(&t->ssl, cli->resume);
  mbedtls_ssl_set_verify(&t->ssl, &scr_tls_vrfy_cb, t);
  t->sock = sock;
  t->cli = cli; /* the tctx owns the per-request config now */
  mbedtls_ssl_set_bio(&t->ssl, t, scr_tls_bio_send, scr_tls_bio_recv, NULL);
  scr_net_sock_set_transport(sock, &SCR_TLS_OPS, t);
}

/* The fetch unit's https leg: the same per-request client config +
 * transport wrap https.request uses, split apart because fetch dials a
 * RESOLVED IP while SNI and certificate verification must see the URL
 * hostname. The ctx moves into the socket's transport at wrap time. */
void *scr_tls_fetch_client_ctx(ScrStr *host /*borrowed*/, bool reject_unauthorized) {
  return scr_tls_cli_new(host, reject_unauthorized, NULL, 0);
}

void scr_tls_fetch_client_wrap(ScrNetSocket *sock, void *ctx) {
  scr_tls_cli_wrap(sock, ctx);
}

ScrHttpClientReq *scr_https_request(ScrStr *host /*borrowed*/, double port,
                                     ScrStr *path /*borrowed*/, ScrStr *method /*borrowed*/,
                                     double timeout_ms, ScrArr *header_pairs /*borrowed*/,
                                     bool auto_end, bool reject_unauthorized,
                                     const char *ca /*borrowed, len 0 = none*/, size_t ca_len,
                                     ScrClosure *cb /*moves, nullable*/, ScrHttpRespFn fn) {
  ScrTlsCli *cli = scr_tls_cli_new(host, reject_unauthorized, ca, ca_len);
  return scr_http_request_ex(host, port, path, method, timeout_ms, header_pairs, auto_end, cb,
                              fn, 443, &scr_tls_cli_wrap, cli);
}

/* https.get('https://host/path') — the URL-string spelling, sharing
 * scr_http.c's parse (which rejects a non-https scheme here with Node's
 * ERR_INVALID_PROTOCOL) and dialing through the same per-request client
 * config as the options form. No options means Node's defaults: the
 * certificate is verified against the default trust anchors. */
ScrHttpClientReq *scr_https_request_url(ScrStr *url /*borrowed*/, ScrStr *method /*borrowed*/,
                                         bool auto_end, ScrClosure *cb /*moves, nullable*/,
                                         ScrHttpRespFn fn) {
  ScrStr *host;
  ScrStr *path;
  double port;
  if (!scr_http_url_parts(url, true, &host, &port, &path, NULL)) {
    if (cb) scr_closure_release(cb);
    return NULL; /* Invalid URL / ERR_INVALID_PROTOCOL pending */
  }
  ScrArr *pairs = scr_arr_new(SCR_ELEM_STR, 0);
  ScrHttpClientReq *c = scr_https_request(host, port, path, method, 0, pairs, auto_end,
                                           true /* rejectUnauthorized */, NULL, 0, cb, fn);
  scr_arr_release(pairs);
  scr_str_release(host);
  scr_str_release(path);
  return c;
}

/* https.request(url, options[, cb]) — scr_http_request_url_opts over the
 * same per-request TLS client config the options form dials with (the
 * scheme check rejects a non-https URL here, Node's
 * ERR_INVALID_PROTOCOL). */
ScrHttpClientReq *scr_https_request_url_opts(ScrStr *url /*borrowed*/, ScrStr *method /*borrowed*/,
                                             double timeout_ms, ScrArr *header_pairs /*borrowed*/,
                                             bool auto_end, bool reject_unauthorized,
                                             const char *ca /*borrowed, len 0 = none*/,
                                             size_t ca_len, ScrClosure *cb /*moves, nullable*/,
                                             ScrHttpRespFn fn) {
  ScrStr *host;
  ScrStr *path;
  double port;
  if (!scr_http_url_parts(url, true, &host, &port, &path, NULL)) {
    if (cb) scr_closure_release(cb);
    return NULL; /* Invalid URL / ERR_INVALID_PROTOCOL pending */
  }
  ScrHttpClientReq *c = scr_https_request(host, port, path, method, timeout_ms, header_pairs,
                                           auto_end, reject_unauthorized, ca, ca_len, cb, fn);
  scr_str_release(host);
  scr_str_release(path);
  return c;
}

/* https.request(url, { agent, ... }[, cb]) — scr_http_request_url_agent's
 * twin with the TLS dial and the two https-only option slots. The portless
 * sentinel is the same rule (Node's merge lets agent.defaultPort decide
 * exactly when the authority wrote no port). */
ScrHttpClientReq *scr_https_request_url_agent(ScrStr *url /*borrowed*/, ScrStr *method /*borrowed*/,
                                              double timeout_ms, ScrArr *header_pairs /*borrowed*/,
                                              bool auto_end, bool reject_unauthorized,
                                              const char *ca /*borrowed, len 0 = none*/,
                                              size_t ca_len, const ScrDyn *agent /*borrowed*/,
                                              ScrClosure *cb /*moves, nullable*/,
                                              ScrHttpRespFn fn) {
  ScrStr *host;
  ScrStr *path;
  double port;
  bool explicit_port = false;
  if (!scr_http_url_parts(url, true, &host, &port, &path, &explicit_port)) {
    if (cb) scr_closure_release(cb);
    return NULL; /* Invalid URL / ERR_INVALID_PROTOCOL pending */
  }
  ScrHttpClientReq *c = scr_https_request_agent(host, explicit_port ? port : -1, path, method,
                                                 timeout_ms, header_pairs, auto_end,
                                                 reject_unauthorized, ca, ca_len, agent, cb, fn);
  scr_str_release(host);
  scr_str_release(path);
  return c;
}

ScrHttpClientReq *scr_https_request_agent(ScrStr *host /*borrowed*/, double port,
                                           ScrStr *path /*borrowed*/, ScrStr *method /*borrowed*/,
                                           double timeout_ms, ScrArr *header_pairs /*borrowed*/,
                                           bool auto_end, bool reject_unauthorized,
                                           const char *ca /*borrowed, len 0 = none*/, size_t ca_len,
                                           const ScrDyn *agent /*borrowed*/,
                                           ScrClosure *cb /*moves, nullable*/, ScrHttpRespFn fn) {
  ScrTlsCli *cli = scr_tls_cli_new(host, reject_unauthorized, ca, ca_len);
  return scr_http_request_agent_ex(host, port, path, method, timeout_ms, header_pairs, auto_end,
                                    agent, cb, fn, 443, &scr_tls_cli_wrap, cli);
}

/* ── RUNTIME options records (the divergence-66 stance) ────────────────
 * A non-literal options value — the checked-dynamic JS lane's dyn record
 * — reads its members at RUNTIME. Members the literal path lowers take
 * the same lowering; members whose literal forms are compile fences
 * become runtime gates that THROW the catchable fence instead of
 * behaving differently; undocumented keys drop exactly like Node drops
 * them (the value already evaluated, so dropping is always safe). */

static void scr_tls_opt_fence(const char *api, const char *key, const char *hint) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, api);
  scr_jb_puts(&b, " option '");
  scr_jb_puts(&b, key);
  scr_jb_puts(&b, "' has no static lowering — ");
  scr_jb_puts(&b, hint);
  scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
}

/* JS truthiness over the dyn kinds — Node reads requestCert /
 * rejectUnauthorized through `if (options.x)`. */
static bool scr_tls_dyn_truthy(const ScrDyn *v) {
  switch (v->kind) {
  case SCR_DYN_UNDEF:
  case SCR_DYN_NULL: return false;
  case SCR_DYN_BOOL: return v->v.b;
  case SCR_DYN_NUM: return v->v.num != 0 && v->v.num == v->v.num;
  case SCR_DYN_STR: return v->v.str->len > 0;
  default: return true; /* objects, arrays, functions, handles, bytes */
  }
}

/* PEM material from a runtime option value: a string, a Buffer/Uint8Array,
 * or an array of those. `concat` (the client `ca` bundle) joins array
 * entries; cert/key arrays accept exactly one entry (one identity per
 * server here — multi-key servers fence). Returns +1 bytes, or NULL with
 * the exception pending. `what` names the fence ("a tls.createServer
 * 'cert' option"). */
static ScrBytes *scr_tls_pem_dyn(const ScrDyn *v, const char *what, const char *prop, bool concat) {
  if (v->kind == SCR_DYN_STR) {
    ScrBytes *b = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)v->v.str->len));
    memcpy(b->data, v->v.str->data, v->v.str->len);
    return b;
  }
  if (v->kind == SCR_DYN_BYTES) return scr_dyn_bytes_copy_out(v);
  if (v->kind == SCR_DYN_ARR) {
    if (v->v.arr.len == 0) {
      ScrJsonBuf b;
      scr_jb_init(&b);
      scr_jb_puts(&b, what);
      scr_jb_puts(&b, " holding an empty array has no static lowering — pass PEM material");
      scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
      return NULL;
    }
    if (v->v.arr.len > 1 && !concat) {
      ScrJsonBuf b;
      scr_jb_init(&b);
      scr_jb_puts(&b, what);
      scr_jb_puts(&b, " with more than one array entry has no static lowering — one cert/key pair per server here");
      scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
      return NULL;
    }
    /* concatenate (mbedTLS parses concatenated PEM — the ca-bundle shape) */
    size_t total = 0;
    for (size_t i = 0; i < v->v.arr.len; i++) {
      const ScrDyn *e = v->v.arr.items[i];
      if (e->kind == SCR_DYN_STR) total += e->v.str->len + 1;
      else if (e->kind == SCR_DYN_BYTES) total += e->v.bytes->len + 1;
      else {
        scr_dyn_prop_type_fail(prop, "of type string or an instance of Buffer, TypedArray, or DataView", e);
        return NULL;
      }
    }
    ScrBytes *b = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)total));
    size_t off = 0;
    for (size_t i = 0; i < v->v.arr.len; i++) {
      const ScrDyn *e = v->v.arr.items[i];
      const char *p = e->kind == SCR_DYN_STR ? e->v.str->data : (const char *)e->v.bytes->data;
      size_t n = e->kind == SCR_DYN_STR ? e->v.str->len : e->v.bytes->len;
      memcpy(b->data + off, p, n);
      off += n;
      b->data[off++] = '\n'; /* PEM blocks join on line boundaries */
    }
    return b;
  }
  if (prop != NULL) scr_dyn_prop_type_fail(prop, "of type string or an instance of Buffer, TypedArray, or DataView", v);
  else scr_dyn_arg_type_fail(what, "of type string or an instance of Buffer or Uint8Array", v);
  return NULL;
}

/* The literal path's runtime-valued cert/key extraction (the compiler's
 * tls.pemDyn libCall): `what` arrives precomposed. undefined throws — the
 * literal walk required the member's presence. */
ScrBytes *scr_tls_pem_from_dyn(const ScrDyn *v, const char *what) {
  if (v->kind == SCR_DYN_UNDEF || v->kind == SCR_DYN_NULL) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, what);
    scr_jb_puts(&b, " holding undefined has no static lowering — pass PEM material (a string or a Buffer)");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
    return NULL;
  }
  return scr_tls_pem_dyn(v, what, NULL, false);
}

/* The tls/https createServer documented keys OUTSIDE the implemented set
 * (cert/key/ca/requestCert/rejectUnauthorized/SNICallback walk their own
 * arms below): present-with-a-value throws the runtime fence — an option
 * that changes Node-observable behavior must work or fence, never
 * silently drop. Undocumented keys drop, exactly Node. */
static const char *const SCR_TLS_SRV_FENCED_OPTIONS[] = {
  "ALPNProtocols", "ALPNCallback", "allowHalfOpen", "ciphers",
  "clientCertEngine", "crl", "dhparam", "ecdhCurve", "enableTrace",
  "handshakeTimeout", "highWaterMark", "honorCipherOrder", "keepAlive",
  "keepAliveInitialDelay", "maxVersion", "minVersion", "noDelay",
  "passphrase", "pauseOnConnect", "pfx", "privateKeyEngine",
  "privateKeyIdentifier", "pskCallback", "pskIdentityHint", "requestOCSP",
  "secureContext", "secureOptions", "secureProtocol", "sessionIdContext",
  "sessionTimeout", "sigalgs", "ticketKeys", NULL,
};

/* ── Node's cipher-string verdict (tls.createSecureContext ciphers) ─────
 * Node's processCiphers splits the string on ':' and sends the TLS_ parts to
 * SSL_CTX_set_ciphersuites and the rest to SSL_CTX_set_cipher_list. The
 * OpenSSL rule grammar is modeled from the measured oracle: the token sets
 * are scr_tls_ciph.h (generated), the directive and character rules are
 * the ones Node's verdicts fixed (lab fuzz: 0 mismatches on the structured
 * vocabulary; see the report for the residual classes). Verdicts:
 * SCR_CIPH_OK, SCR_CIPH_NO_MATCH (empty list), SCR_CIPH_INVALID_CMD (a
 * malformed directive), SCR_CIPH_EMPTY_PARTS (only ':' separators:
 * ERR_INVALID_ARG_VALUE). */
typedef enum { SCR_CIPH_OK = 0, SCR_CIPH_NO_MATCH, SCR_CIPH_INVALID_CMD, SCR_CIPH_EMPTY_PARTS } ScrCiphVerdict;

typedef struct { uint64_t in[SCR_CIPH_WORDS], killed[SCR_CIPH_WORDS]; } ScrCiphState;

static bool scr_ciph_sep(char c) { return c == ':' || c == ' ' || c == ';' || c == ','; }
static bool scr_ciph_op(char c) { return c == '!' || c == '-' || c == '+'; }
static bool scr_ciph_name_char(char c) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
         c == '_' || c == '.' || c == '=' || c == '-';
}

/* The token table index for tok[0..n), or -1 (a token Node's build does not know). */
static int scr_ciph_tok_find(const char *tok, size_t n) {
  for (size_t k = 0; k < SCR_CIPH_TOK_COUNT; k++) {
    const char *t = SCR_CIPH_TOKS[k].tok;
    if (strlen(t) == n && memcmp(t, tok, n) == 0) return (int)k;
  }
  return -1;
}

/* A valid @-directive at s[p] ('@'): returns the index after it, or -1. */
static long scr_ciph_directive_end(const char *s, size_t n, size_t p) {
  size_t q;
  if (n - p >= 9 && memcmp(s + p, "@STRENGTH", 9) == 0) q = p + 9;
  else if (n - p >= 11 && memcmp(s + p, "@SECLEVEL=", 10) == 0 && s[p + 10] >= '0' && s[p + 10] <= '5') q = p + 11;
  else return -1;
  if (q < n && !(scr_ciph_sep(s[q]) || s[q] == '@' || s[q] == '!' || s[q] == '+')) return -1;
  return (long)q;
}

static void scr_ciph_apply(ScrCiphState *st, char op, const uint64_t set[SCR_CIPH_WORDS]) {
  for (int w = 0; w < SCR_CIPH_WORDS; w++) {
    if (op == '-') st->in[w] &= ~set[w];
    else if (op == '!') { st->in[w] &= ~set[w]; st->killed[w] |= set[w]; }
    else st->in[w] |= set[w] & ~st->killed[w];
  }
}

static bool scr_ciph_hit(const ScrCiphState *st, const uint64_t set[SCR_CIPH_WORDS]) {
  for (int w = 0; w < SCR_CIPH_WORDS; w++) if (st->in[w] & set[w]) return true;
  return false;
}

static bool scr_ciph_empty(const uint64_t in[SCR_CIPH_WORDS]) {
  for (int w = 0; w < SCR_CIPH_WORDS; w++) if (in[w] != 0) return false;
  return true;
}

/* SSL_CTX_set_cipher_list over one TLS<=1.2 list (TLS_ parts are filtered out
 * by the caller, as Node does). */
static ScrCiphVerdict scr_ciph_list_verdict(const char *in, size_t n) {
  n = strnlen(in, n); /* a C string: the list ends at the first NUL */
  /* a SUITEB prefix: never empty, and its directives are not checked */
  if (n >= 9 && (memcmp(in, "SUITEB128", 9) == 0 || memcmp(in, "SUITEB192", 9) == 0)) return SCR_CIPH_OK;
  static const char DEF_EXP[] = "ALL:!COMPLEMENTOFDEFAULT:!eNULL";
  char *buf = NULL;
  const char *s = in;
  if (n >= 7 && memcmp(in, "DEFAULT", 7) == 0) {
    const size_t el = sizeof DEF_EXP - 1;
    buf = malloc(el + (n - 7) + 1);
    if (!buf) scr_tls_oom();
    memcpy(buf, DEF_EXP, el);
    memcpy(buf + el, in + 7, n - 7);
    buf[el + n - 7] = '\0';
    s = buf;
    n = el + n - 7;
  }
  static const uint64_t ZERO_SET[SCR_CIPH_WORDS] = {0};
  ScrCiphState st;
  memset(&st, 0, sizeof st);
  ScrCiphVerdict verdict = SCR_CIPH_OK;
  size_t i = 0;
  size_t last_end = (size_t)-1; /* where the previous token ended: an infix '+' starts there */
  while (i < n) {
    while (i < n && scr_ciph_sep(s[i])) i++;
    if (i >= n) break;
    char op = 'a';
    const size_t op_pos = i;
    if (scr_ciph_op(s[i])) { op = s[i]; i++; }
    const bool infix = op == '+' && op_pos == last_end;
    if (i < n && s[i] == '@') {
      if (op != 'a') { verdict = SCR_CIPH_INVALID_CMD; break; }
      long e = scr_ciph_directive_end(s, n, i);
      if (e < 0) { verdict = SCR_CIPH_INVALID_CMD; break; }
      i = (size_t)e;
      while (i < n && !scr_ciph_sep(s[i])) i++;
      continue;
    }
    size_t j = i;
    while (j < n && scr_ciph_name_char(s[j])) j++;
    const size_t tl = j - i;
    if (tl == 0) {
      if (op != 'a') { verdict = SCR_CIPH_INVALID_CMD; break; }
      if (i >= n || scr_ciph_sep(s[i])) continue;
      verdict = SCR_CIPH_INVALID_CMD;
      break;
    }
    const char *tok = s + i;
    const int ti = scr_ciph_tok_find(tok, tl);
    const bool is_default = tl == 7 && memcmp(tok, "DEFAULT", 7) == 0;
    const bool known = ti >= 0 && !is_default; /* DEFAULT is a prefix only: mid-string it is unknown (MEASURED) */
    const uint64_t *set = (ti >= 0 && !is_default) ? SCR_CIPH_TOKS[ti].set : ZERO_SET;
    i = j;
    if (i < n && !scr_ciph_sep(s[i])) {
      /* an unknown name skips its whole token silently (operators included); a known one rejects a stray character */
      if (!known) { while (i < n && !scr_ciph_sep(s[i])) i++; continue; }
      if (!scr_ciph_op(s[i]) && s[i] != '@') { verdict = SCR_CIPH_INVALID_CMD; break; }
    }
    if (i < n && s[i] == '@') {
      long e = scr_ciph_directive_end(s, n, i);
      if (e < 0) {
        if (known) { verdict = SCR_CIPH_INVALID_CMD; break; }
        while (i < n && !scr_ciph_sep(s[i])) i++;
        continue;
      }
      if (!known) { while (i < n && !scr_ciph_sep(s[i])) i++; continue; }
      i = (size_t)e;
      while (i < n && !scr_ciph_sep(s[i])) i++;
    }
    last_end = i;
    if (op == '+') {
      /* MEASURED: an infix '+' (no separator before it) clears the list when its operand matches nothing */
      if (infix && !scr_ciph_hit(&st, set)) memset(st.in, 0, sizeof st.in);
      continue;
    }
    scr_ciph_apply(&st, op, set);
  }
  free(buf);
  if (verdict != SCR_CIPH_OK) return verdict;
  return scr_ciph_empty(st.in) ? SCR_CIPH_NO_MATCH : SCR_CIPH_OK;
}

/* SSL_CTX_set_ciphersuites over the TLS_ parts (their own list: TLS1.3 names,
 * '!' kills; no directives). */
static ScrCiphVerdict scr_ciph_suites_verdict(const char *cs) {
  /* MEASURED: set_ciphersuites is empty only when no positive known suite
   * name is present; '!' never empties it (A:!A is OK, !A is no match) */
  static const char *const T13[] = {
    "TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256", "TLS_AES_128_GCM_SHA256",
    "TLS_AES_128_CCM_SHA256", "TLS_AES_128_CCM_8_SHA256", NULL,
  };
  const char *p = cs;
  while (*p) {
    const char *e = strchr(p, ':');
    const size_t plen = e ? (size_t)(e - p) : strlen(p);
    if (plen > 0 && p[0] != '!') {
      for (size_t k = 0; T13[k] != NULL; k++) {
        if (strlen(T13[k]) == plen && memcmp(T13[k], p, plen) == 0) return SCR_CIPH_OK;
      }
    }
    if (!e) break;
    p = e + 1;
  }
  return SCR_CIPH_NO_MATCH;
}

/* Node's configSecureContext ciphers verdict for a STRING value (the
 * caller checked the type). "" and the default list are OK. */
static ScrCiphVerdict scr_ciph_verdict(const char *ciphers) {
  if (ciphers[0] == '\0') return SCR_CIPH_OK;
  const size_t len = strlen(ciphers);
  char *cl = malloc(len + 1), *cs = malloc(len + 1);
  if (!cl || !cs) scr_tls_oom();
  size_t nl = 0, ns = 0, nparts = 0, nonempty = 0;
  const char *p = ciphers;
  for (;;) {
    const char *e = strchr(p, ':');
    const size_t plen = e ? (size_t)(e - p) : strlen(p);
    nparts++;
    if (plen > 0) {
      nonempty++;
      const bool tls = plen >= 4 && memcmp(p, "TLS_", 4) == 0;
      const bool ntls = plen >= 5 && p[0] == '!' && memcmp(p + 1, "TLS_", 4) == 0;
      char **dst = (tls || ntls) ? &cs : &cl;
      size_t *dn = (tls || ntls) ? &ns : &nl;
      if (*dn > 0) (*dst)[(*dn)++] = ':';
      memcpy(*dst + *dn, p, plen);
      *dn += plen;
    }
    if (!e) break;
    p = e + 1;
  }
  cl[nl] = '\0';
  cs[ns] = '\0';
  ScrCiphVerdict v = SCR_CIPH_OK;
  if (nonempty == 0) v = SCR_CIPH_EMPTY_PARTS;
  else {
    if (ns > 0) v = scr_ciph_suites_verdict(cs);
    if (v == SCR_CIPH_OK && nl > 0) v = scr_ciph_list_verdict(cl, nl);
  }
  (void)nparts;
  free(cl);
  free(cs);
  return v;
}

/* ERR_INVALID_ARG_VALUE for a ciphers string of only ':' separators: Node's
 * util.inspect of the N empty parts. Up to 6 entries: one line. More: the
 * groupArrayElements layout (columns = min(round(sqrt(2.5 N)), 12), cells
 * "''" in columns, 100 entries shown then "... k more items"). Throws. */
static void scr_ciph_throw_empty_parts(size_t n) {
  char arr[2048];
  size_t off = 0;
#define SCR_CIPH_APPEND(...) do { int w_ = snprintf(arr + off, sizeof arr - off, __VA_ARGS__); if (w_ > 0) off += (size_t)w_; } while (0)
  if (n <= 6) {
    SCR_CIPH_APPEND("[ ");
    for (size_t k = 0; k < n; k++) SCR_CIPH_APPEND(k ? ", ''" : "''");
    SCR_CIPH_APPEND(" ]");
  } else {
    const size_t shown = n < 100 ? n : 100;
    const size_t more = n - shown;
    double cols_d = floor(sqrt(2.5 * (double)shown) + 0.5);
    size_t cols = cols_d > 12.0 ? 12 : (size_t)cols_d;
    SCR_CIPH_APPEND("[");
    for (size_t i = 0; i < shown; i += cols) {
      const size_t max = i + cols < shown ? i + cols : shown;
      SCR_CIPH_APPEND("%s\n  ", i == 0 ? "" : ",");
      for (size_t j = i; j < max; j++) SCR_CIPH_APPEND(j > i ? ", ''" : "''");
    }
    if (more > 0) SCR_CIPH_APPEND(",\n  ... %zu more item%s", more, more == 1 ? "" : "s");
    SCR_CIPH_APPEND("\n]");
  }
#undef SCR_CIPH_APPEND
  /* Node's ERR_INVALID_ARG_VALUE cuts the rendering: inspect(...) longer than
   * 128 characters keeps its first 128 and appends "..." (measured) */
  if (off > 128) {
    arr[128] = '\0';
    snprintf(arr + 128, sizeof arr - 128, "...");
  }
  char msg[2304];
  const int len = snprintf(msg, sizeof msg,
                           "The property 'options.ciphers' is invalid. Received %s", arr);
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)len, "ERR_INVALID_ARG_VALUE");
}

/* The createSecureContext/createServer ciphers verdict over a PRESENT string
 * (the ladder checked the type). Node runs it before any PEM work. false =
 * exception pending. */
static bool scr_tls_ciphers_check(const ScrDyn *opts) {
  const ScrDyn *v = scr_dyn_obj_get(opts, "ciphers", 7);
  if (v == NULL || v->kind != SCR_DYN_STR) return true;
  char *s = malloc(v->v.str->len + 1);
  if (!s) scr_tls_oom();
  memcpy(s, v->v.str->data, v->v.str->len);
  s[v->v.str->len] = '\0';
  bool ok = true;
  switch (scr_ciph_verdict(s)) {
    case SCR_CIPH_OK: break;
    case SCR_CIPH_NO_MATCH:
      scr_throw_error_msg_code(SCR_ERR_ERROR, "error:0A0000B9:SSL routines::no cipher match", strlen("error:0A0000B9:SSL routines::no cipher match"),
                               "ERR_SSL_NO_CIPHER_MATCH");
      ok = false;
      break;
    case SCR_CIPH_INVALID_CMD:
      scr_throw_error_msg_code(SCR_ERR_ERROR, "error:0A000118:SSL routines::invalid command", strlen("error:0A000118:SSL routines::invalid command"),
                               "ERR_SSL_INVALID_COMMAND");
      ok = false;
      break;
    case SCR_CIPH_EMPTY_PARTS: {
      size_t parts = 1;
      for (size_t k = 0; k < v->v.str->len; k++) if (s[k] == ':') parts++;
      scr_ciph_throw_empty_parts(parts);
      ok = false;
      break;
    }
  }
  free(s);
  return ok;
}

/* ── the typed option-validation ladders (checked-dynamic lane) ────────
 * Node's configSecureContext / Server-constructor argument contracts over
 * every PRESENT validated key, run BEFORE the pem walk and its fences so
 * Node's typed errors always come first (the invalid-input probes isolate
 * one bad option per call, so the fixed order below matches each).
 * false = exception pending. */
static bool scr_tls_opts_validate(const ScrDyn *opts) {
  if (opts == NULL || opts->kind != SCR_DYN_OBJ) return true;
  static const char *const STR_OPTS[] = { "ciphers", "passphrase", "ecdhCurve", "sessionIdContext", NULL };
  for (size_t i = 0; STR_OPTS[i] != NULL; i++) {
    const ScrDyn *v = scr_dyn_obj_get(opts, STR_OPTS[i], strlen(STR_OPTS[i]));
    if (v != NULL && v->kind != SCR_DYN_UNDEF && v->kind != SCR_DYN_NULL && v->kind != SCR_DYN_STR) {
      char name[48];
      snprintf(name, sizeof name, "options.%s", STR_OPTS[i]);
      scr_dyn_prop_type_fail(name, "of type string", v);
      return false;
    }
  }
  static const char *const ENGINE_OPTS[] = { "clientCertEngine", "privateKeyEngine", "privateKeyIdentifier", NULL };
  for (size_t i = 0; ENGINE_OPTS[i] != NULL; i++) {
    const ScrDyn *v = scr_dyn_obj_get(opts, ENGINE_OPTS[i], strlen(ENGINE_OPTS[i]));
    if (v != NULL && v->kind != SCR_DYN_UNDEF && v->kind != SCR_DYN_NULL && v->kind != SCR_DYN_STR) {
      char name[48];
      snprintf(name, sizeof name, "options.%s", ENGINE_OPTS[i]);
      scr_dyn_prop_type_fail(name, "of type string or one of null or undefined", v);
      return false;
    }
  }
  static const char *const VERSION_OPTS[] = { "minVersion", "maxVersion", NULL };
  for (size_t i = 0; VERSION_OPTS[i] != NULL; i++) {
    const ScrDyn *v = scr_dyn_obj_get(opts, VERSION_OPTS[i], strlen(VERSION_OPTS[i]));
    if (v == NULL || v->kind == SCR_DYN_UNDEF) continue;
    bool valid = false;
    if (v->kind == SCR_DYN_STR) {
      static const char *const KNOWN[] = { "TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3", NULL };
      for (size_t k = 0; KNOWN[k] != NULL; k++) {
        if (v->v.str->len == strlen(KNOWN[k]) && memcmp(v->v.str->data, KNOWN[k], v->v.str->len) == 0) {
          valid = true;
          break;
        }
      }
    }
    if (!valid) {
      /* %j: strings render JSON-quoted, everything else inspect-lite. */
      char rendered[96];
      if (v->kind == SCR_DYN_STR) {
        snprintf(rendered, sizeof rendered, "\"%.*s\"",
                 (int)(v->v.str->len < 80 ? v->v.str->len : 80), v->v.str->data);
      } else {
        /* %j over non-strings: JSON.stringify's scalar renderings. */
        char lite[64];
        snprintf(rendered, sizeof rendered, "%s", scr_dyn_inspect_lite(v, lite, sizeof lite));
      }
      char msg[192];
      int len = snprintf(msg, sizeof msg, "%s is not a valid %s TLS protocol version",
                         rendered, VERSION_OPTS[i][2] == 'n' ? "minimum" : "maximum");
      scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)len, "ERR_TLS_INVALID_PROTOCOL_VERSION");
      return false;
    }
  }
  static const char *const NUM_OPTS[] = { "handshakeTimeout", "keepAliveInitialDelay", NULL };
  for (size_t i = 0; NUM_OPTS[i] != NULL; i++) {
    const ScrDyn *v = scr_dyn_obj_get(opts, NUM_OPTS[i], strlen(NUM_OPTS[i]));
    if (v != NULL && v->kind != SCR_DYN_UNDEF && v->kind != SCR_DYN_NULL && v->kind != SCR_DYN_NUM) {
      char name[48];
      snprintf(name, sizeof name, "options.%s", NUM_OPTS[i]);
      scr_dyn_prop_type_fail(name, "of type number", v);
      return false;
    }
  }
  {
    const ScrDyn *v = scr_dyn_obj_get(opts, "sessionTimeout", 14);
    if (v != NULL && v->kind != SCR_DYN_UNDEF && v->kind != SCR_DYN_NULL) {
      if (v->kind != SCR_DYN_NUM) {
        scr_dyn_prop_type_fail("options.sessionTimeout", "of type number", v);
        return false;
      }
      double n = v->v.num;
      char recv[48], msg[192];
      if (!(isfinite(n) && trunc(n) == n)) {
        scr_num_received(n, recv);
        int len = snprintf(msg, sizeof msg,
                           "The value of \"options.sessionTimeout\" is out of range. It must be an integer. Received %s", recv);
        scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
        return false;
      }
      if (n < 0 || n > 2147483647.0) {
        scr_num_received(n, recv);
        int len = snprintf(msg, sizeof msg,
                           "The value of \"options.sessionTimeout\" is out of range. It must be >= 0 && <= 2147483647. Received %s", recv);
        scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
        return false;
      }
    }
  }
  {
    const ScrDyn *v = scr_dyn_obj_get(opts, "ticketKeys", 10);
    if (v != NULL && v->kind != SCR_DYN_UNDEF && v->kind != SCR_DYN_NULL) {
      if (v->kind != SCR_DYN_BYTES) {
        scr_dyn_prop_type_fail("options.ticketKeys", "an instance of Buffer, TypedArray, or DataView", v);
        return false;
      }
      double bytelen = scr_bytes_byte_len(v->v.bytes);
      if (bytelen != 48) {
        char msg[160];
        int len = snprintf(msg, sizeof msg,
                           "The property 'options.ticketKeys' must be exactly 48 bytes. Received %.0f", bytelen);
        scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)len, "ERR_INVALID_ARG_VALUE");
        return false;
      }
    }
  }
  return true;
}

/* ── option walk over a runtime options record ─────────────────────────
 * Shared by the server constructors (ctx = false) and createSecureContext
 * (ctx = true). Node's typed validations run first (scr_tls_opts_validate).
 * Then cert, key and ca take their PEM material with Node's
 * ERR_INVALID_ARG_TYPE text (a null member reads as absent). In ctx mode
 * cert arrays are one chain, a key array's last entry is the key, and
 * passphrase / minVersion / maxVersion are taken (the server still fences
 * them). Other documented members fence by name; undocumented ones drop
 * like Node drops them. */
enum { SCR_TLS_V_NONE = 0, SCR_TLS_V_TLS1, SCR_TLS_V_TLS11, SCR_TLS_V_TLS12, SCR_TLS_V_TLS13 };

typedef struct ScrTlsOpts {
  ScrBytes *cert, *key, *ca, *pass; /* +1 each, NULL when absent */
  int minv, maxv;
} ScrTlsOpts;

static void scr_tls_opts_init(ScrTlsOpts *o) { memset(o, 0, sizeof *o); }

static void scr_tls_opts_free(ScrTlsOpts *o) {
  scr_bytes_release(o->cert);
  scr_bytes_release(o->key);
  scr_bytes_release(o->ca);
  scr_bytes_release(o->pass);
  scr_tls_opts_init(o);
}

/* A validated protocol-version string -> SCR_TLS_V_* (the ladder rejects
 * anything else before this runs). */
static int scr_tls_version_code(const ScrDyn *v) {
  static const char *const N[] = { "TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3", NULL };
  for (size_t k = 0; N[k] != NULL; k++) {
    if (v->v.str->len == strlen(N[k]) && memcmp(v->v.str->data, N[k], v->v.str->len) == 0) {
      return (int)k + 1;
    }
  }
  return SCR_TLS_V_NONE;
}

static ScrBytes *scr_tls_bytes_of_str(const ScrDyn *v) {
  ScrBytes *b = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)v->v.str->len));
  memcpy(b->data, v->v.str->data, v->v.str->len);
  return b;
}

static bool scr_tls_opts_collect(const ScrDyn *opts, const char *api, bool ctx, ScrTlsOpts *o) {
  if (opts == NULL || opts->kind != SCR_DYN_OBJ) {
    scr_dyn_arg_type_fail("options", "of type object", opts ? opts : scr_dyn_undefined());
    return false;
  }
  if (!scr_tls_opts_validate(opts)) return false; /* Node's typed errors first */
  if (!scr_tls_ciphers_check(opts)) return false; /* Node's cipher verdict, before the material */
  /* No getter path in this walk: an option provided by an ENUMERABLE
   * ACCESSOR would read as the SLOT's undefined and be taken for absent,
   * which on a TLS options bag means a security setting silently
   * ignored. Loud. */
  scr_dyn_obj_acc_fence(opts, "a tls options object");
  if (scr_exc_pending()) return false;
  bool ok = true;
  for (size_t i = 0; ok && i < opts->v.obj.len; i++) {
    const ScrDynEntry *e = &opts->v.obj.entries[i];
    const ScrDyn *v = e->value;
    if (v->kind == SCR_DYN_UNDEF) continue; /* an undefined member reads as absent, like Node */
    if (strcmp(e->key, "cert") == 0 || strcmp(e->key, "key") == 0) {
      if (v->kind == SCR_DYN_NULL) continue; /* null reads as absent (measured: Node accepts it) */
      const bool is_cert = e->key[0] == 'c';
      if (ctx && v->kind == SCR_DYN_ARR) {
        if (v->v.arr.len == 0) continue; /* an empty list is no material (measured) */
        if (!is_cert) v = v->v.arr.items[v->v.arr.len - 1]; /* the last key wins */
      }
      char what[96], prop[24];
      snprintf(what, sizeof what, "a %s '%s' option", api, e->key);
      snprintf(prop, sizeof prop, "options.%s", e->key);
      ScrBytes *b = scr_tls_pem_dyn(v, what, prop, ctx && is_cert);
      if (b == NULL) { ok = false; break; }
      ScrBytes **slot = is_cert ? &o->cert : &o->key;
      scr_bytes_release(*slot);
      *slot = b;
      continue;
    }
    if (strcmp(e->key, "ca") == 0) {
      /* the CA bundle: an array of PEM members is one bundle (Node accepts
       * any count, including none); the bytes are retained by the caller */
      if (v->kind == SCR_DYN_NULL) continue;
      if (v->kind == SCR_DYN_ARR && v->v.arr.len == 0) continue;
      char what[96];
      snprintf(what, sizeof what, "a %s 'ca' option", api);
      ScrBytes *b = scr_tls_pem_dyn(v, what, "options.ca", true);
      if (b == NULL) { ok = false; break; }
      scr_bytes_release(o->ca);
      o->ca = b;
      continue;
    }
    if (ctx && strcmp(e->key, "passphrase") == 0) {
      /* the ladder checked the type; null/undefined are absent */
      if (v->kind == SCR_DYN_STR) {
        scr_bytes_release(o->pass);
        o->pass = scr_tls_bytes_of_str(v);
      }
      continue;
    }
    if (ctx && strcmp(e->key, "minVersion") == 0) {
      if (v->kind == SCR_DYN_STR) o->minv = scr_tls_version_code(v);
      continue;
    }
    if (ctx && strcmp(e->key, "maxVersion") == 0) {
      if (v->kind == SCR_DYN_STR) o->maxv = scr_tls_version_code(v);
      continue;
    }
    if (strcmp(e->key, "requestCert") == 0) {
      if (scr_tls_dyn_truthy(v)) {
        scr_tls_opt_fence(api, "requestCert",
                          "client-certificate handshakes are not modeled (SEMANTICS.md divergence 55) — requestCert stays at Node's false default");
        ok = false;
      }
      continue;
    }
    if (strcmp(e->key, "rejectUnauthorized") == 0) {
      continue; /* meaningful only with requestCert, which fences */
    }
    if (strcmp(e->key, "SNICallback") == 0) {
      scr_tls_opt_fence(api, "SNICallback",
                        "SNICallback lowers only on http2.createSecureServer({ allowHTTP1: true, ... }) with a literal options object");
      ok = false;
      continue;
    }
    /* createSecureContext's ciphers: the verdict ran above and the list is
     * not consumed by any handshake yet (see the report); not a fence */
    if (ctx && strcmp(e->key, "ciphers") == 0) continue;
    for (size_t k = 0; SCR_TLS_SRV_FENCED_OPTIONS[k] != NULL; k++) {
      if (strcmp(e->key, SCR_TLS_SRV_FENCED_OPTIONS[k]) == 0) {
        scr_tls_opt_fence(api, e->key,
                          "cert and key (PEM strings or Buffers) are the honestly-implemented members of a runtime options record");
        ok = false;
        break;
      }
    }
    /* anything else: an undocumented key, dropped like Node drops it */
  }
  if (!ok) scr_tls_opts_free(o);
  return ok;
}

/* The server constructors' walk: the collected pair must be present in full
 * (a listener needs its identity). */
bool scr_tls_srv_opts_walk(const ScrDyn *opts, const char *api, ScrBytes **cert_out,
                            ScrBytes **key_out) {
  ScrTlsOpts o;
  scr_tls_opts_init(&o);
  if (!scr_tls_opts_collect(opts, api, false, &o)) return false;
  *cert_out = o.cert; /* moved out */
  *key_out = o.key;
  o.cert = o.key = NULL;
  scr_tls_opts_free(&o); /* the server's `ca` verifies client certificates: inert without requestCert (fenced) */
  if (*cert_out == NULL || *key_out == NULL) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, api);
    scr_jb_puts(&b, " without both cert and key has no static lowering — the supported options are { cert, key } (PEM strings or Buffers)");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
    scr_bytes_release(*cert_out);
    scr_bytes_release(*key_out);
    *cert_out = NULL;
    *key_out = NULL;
    return false;
  }
  return true;
}

/* A PEM failure as Node's catchable Error: the OpenSSL message and code that
 * Node reports for the measured inputs (a missing BEGIN line; an unparseable
 * key; a key missing or mismatching its passphrase). */
static void scr_tls_pem_throw(bool is_key, const char *buf, int err) {
  const char *msg, *code;
  if (is_key) {
    if (err == MBEDTLS_ERR_PK_PASSWORD_REQUIRED || err == MBEDTLS_ERR_PK_PASSWORD_MISMATCH) {
      msg = "error:1C800064:Provider routines::bad decrypt";
      code = "ERR_OSSL_BAD_DECRYPT";
    } else {
      msg = "error:1E08010C:DECODER routines::unsupported";
      code = "ERR_OSSL_UNSUPPORTED";
    }
  } else if (strstr(buf, "-----BEGIN") == NULL) {
    msg = "error:0480006C:PEM routines::no start line";
    code = "ERR_OSSL_PEM_NO_START_LINE";
  } else {
    msg = "error:068000A8:asn1 encoding routines::wrong tag";
    code = "ERR_OSSL_ASN1_WRONG_TAG";
  }
  scr_throw_error_msg_code(SCR_ERR_ERROR, msg, strlen(msg), code);
}

/* Loads one half of the identity into a context; false = exception pending. */
static bool scr_tls_ctx_load_cert(ScrSecureCtx *c, const ScrBytes *b) {
  char *buf = malloc(b->len + 1);
  if (!buf) scr_tls_oom();
  memcpy(buf, b->data, b->len);
  buf[b->len] = 0;
  int r = mbedtls_x509_crt_parse(&c->cert, (const unsigned char *)buf, b->len + 1);
  if (r != 0) scr_tls_pem_throw(false, buf, r);
  free(buf);
  return r == 0;
}

static bool scr_tls_ctx_load_key(ScrSecureCtx *c, const ScrBytes *b, const ScrBytes *pass) {
  char *buf = malloc(b->len + 1);
  if (!buf) scr_tls_oom();
  memcpy(buf, b->data, b->len);
  buf[b->len] = 0;
  int r = mbedtls_pk_parse_key(&c->pk, (const unsigned char *)buf, b->len + 1,
                               pass ? (const unsigned char *)pass->data : NULL,
                               pass ? pass->len : 0, mbedtls_ctr_drbg_random, &scr_tls_drbg);
  if (r != 0) scr_tls_pem_throw(true, buf, r);
  free(buf);
  return r == 0;
}

/* createSecureContext over a RUNTIME options record: Node's typed
 * validations first, then the material. Each half given is parsed (cert may
 * be a chain); a context may hold either half or neither (Node accepts a
 * CA-only or empty context). A PEM failure is a catchable Error.
 * +1, or NULL with the exception pending. */
ScrSecureCtx *scr_tls_create_secure_context_dyn(const ScrDyn *opts /*borrowed*/) {
  ScrTlsOpts o;
  scr_tls_opts_init(&o);
  if (!scr_tls_opts_collect(opts, "tls.createSecureContext", true, &o)) return NULL;
  scr_tls_rng_init();
  ScrSecureCtx *c = scr_secure_ctx_alloc();
  c->minv = o.minv;
  c->maxv = o.maxv;
  c->ca = o.ca; /* moves */
  o.ca = NULL;
  if (o.cert != NULL && !scr_tls_ctx_load_cert(c, o.cert)) goto fail;
  c->has_cert = o.cert != NULL;
  if (o.key != NULL && !scr_tls_ctx_load_key(c, o.key, o.pass)) goto fail;
  c->has_key = o.key != NULL;
  scr_tls_opts_free(&o);
  return c;
fail:
  scr_secure_ctx_release(c);
  scr_tls_opts_free(&o);
  return NULL;
}

ScrNetServer *scr_tls_create_server_dyn(const ScrDyn *opts /*borrowed*/,
                                         ScrClosure *handler /*moves, nullable*/,
                                         ScrNetConnFn fn) {
  ScrBytes *cert, *key;
  if (!scr_tls_srv_opts_walk(opts, "tls.createServer", &cert, &key)) {
    scr_closure_release(handler);
    return NULL;
  }
  ScrNetServer *s = scr_tls_create_server((const char *)cert->data, cert->len,
                                           (const char *)key->data, key->len, handler, fn);
  scr_bytes_release(cert);
  scr_bytes_release(key);
  return s;
}

ScrNetServer *scr_https_create_server_dyn(const ScrDyn *opts /*borrowed*/,
                                           ScrClosure *handler /*moves, nullable*/,
                                           ScrHttpReqFn fn) {
  ScrBytes *cert, *key;
  if (!scr_tls_srv_opts_walk(opts, "https.createServer", &cert, &key)) {
    scr_closure_release(handler);
    return NULL;
  }
  ScrNetServer *s = scr_https_create_server((const char *)cert->data, cert->len,
                                             (const char *)key->data, key->len, handler, fn);
  scr_bytes_release(cert);
  scr_bytes_release(key);
  return s;
}

/* ── tls.connect (the TLS client socket) ──────────────────────────────── */

/* tls.connect's documented keys outside the implemented set: present
 * throws (the server walk's stance). */
static const char *const SCR_TLS_CONNECT_FENCED_OPTIONS[] = {
  "ALPNProtocols", "allowHalfOpen", "autoSelectFamily",
  "autoSelectFamilyAttemptTimeout", "cert", "checkServerIdentity",
  "ciphers", "clientCertEngine", "crl", "dhparam", "ecdhCurve",
  "enableTrace", "family", "fd", "hints", "highWaterMark",
  "honorCipherOrder", "keepAlive", "keepAliveInitialDelay", "key",
  "localAddress", "localPort", "lookup", "maxVersion", "minDHSize",
  "minVersion", "noDelay", "onread", "passphrase", "path", "pfx",
  "privateKeyEngine", "privateKeyIdentifier", "pskCallback", "readable",
  "secureContext", "secureOptions", "secureProtocol", "session",
  "sessionIdContext", "sigalgs", "signal", "socket", "ticketKeys",
  "timeout", "writable", NULL,
};

ScrNetSocket *scr_tls_connect_dyn(double port, ScrStr *host /*borrowed, nullable*/,
                                   const ScrDyn *opts /*borrowed, nullable*/,
                                   ScrClosure *cb /*moves, nullable*/) {
  scr_tls_rng_init();
  bool reject = true;
  ScrBytes *ca = NULL;
  ScrBytes *session_bytes = NULL; /* owned: the `session` option's bytes */
  ScrDyn *ident = NULL; /* owned: the checkServerIdentity option, moved into the client config */
  const ScrStr *servername = NULL;
  const ScrStr *opt_host = NULL;
  bool ok = true;
  if (opts != NULL && opts->kind != SCR_DYN_UNDEF && opts->kind != SCR_DYN_NULL) {
    if (opts->kind != SCR_DYN_OBJ) {
      scr_dyn_arg_type_fail("options", "of type object", opts);
      ok = false;
    }
    if (ok) {
      /* See the connect-options walk above: no getter path here either. */
      scr_dyn_obj_acc_fence(opts, "a tls options object");
      if (scr_exc_pending()) ok = false;
    }
    for (size_t i = 0; ok && i < opts->v.obj.len; i++) {
      const ScrDynEntry *e = &opts->v.obj.entries[i];
      const ScrDyn *v = e->value;
      if (strcmp(e->key, "checkServerIdentity") == 0) {
        /* Node spreads user options over the defaults, so a PRESENT key
         * replaces the builtin verifier even when its value is undefined
         * — validateFunction then throws for anything non-callable. A
         * real function keeps the fence (custom verification has no
         * lowering). */
        if (v->kind != SCR_DYN_FUNC) {
          scr_dyn_prop_type_fail("options.checkServerIdentity", "of type function", v);
          ok = false;
        } else {
          /* the callback runs once the handshake verified (scr_tls_ident_run) */
          scr_dyn_release(ident);
          ident = scr_dyn_retain((ScrDyn *)v);
        }
        continue;
      }
      if (v->kind == SCR_DYN_UNDEF) continue;
      if (strcmp(e->key, "port") == 0) {
        if (port >= 0) continue; /* the argument form wins, like Node */
        if (v->kind == SCR_DYN_NUM) port = v->v.num;
        else if (v->kind == SCR_DYN_STR) port = strtod(v->v.str->data, NULL); /* Node coerces numeric strings */
        else {
          scr_dyn_arg_type_fail("options.port", "of type number", v);
          ok = false;
        }
        continue;
      }
      if (strcmp(e->key, "host") == 0) {
        if (v->kind == SCR_DYN_STR) opt_host = v->v.str;
        else {
          scr_dyn_arg_type_fail("options.host", "of type string", v);
          ok = false;
        }
        continue;
      }
      if (strcmp(e->key, "rejectUnauthorized") == 0) {
        reject = scr_tls_dyn_truthy(v);
        continue;
      }
      if (strcmp(e->key, "ca") == 0) {
        scr_bytes_release(ca);
        ca = scr_tls_pem_dyn(v, "a tls.connect 'ca' option", "options.ca", true);
        if (ca == NULL) ok = false;
        continue;
      }
      if (strcmp(e->key, "session") == 0) {
        /* Node: `if (options.session) setSession(...)`, and setSession throws
         * ERR_INVALID_ARG_TYPE for anything but a buffer. A buffer that is not
         * a session mbedTLS can decode is dropped silently (a full handshake),
         * as OpenSSL's d2i does in Node. */
        if (v->kind == SCR_DYN_BYTES) {
          scr_bytes_release(session_bytes);
          session_bytes = scr_dyn_bytes_copy_out(v);
        } else if (v->kind != SCR_DYN_NULL) {
          static const char SESS_MSG[] = "Session must be a buffer";
          scr_throw_error_msg_code(SCR_ERR_TYPE, SESS_MSG, sizeof SESS_MSG - 1, "ERR_INVALID_ARG_TYPE");
          ok = false;
        }
        continue;
      }
      if (strcmp(e->key, "servername") == 0) {
        if (v->kind == SCR_DYN_STR) servername = v->v.str;
        else {
          scr_dyn_arg_type_fail("options.servername", "of type string", v);
          ok = false;
        }
        continue;
      }
      for (size_t k = 0; SCR_TLS_CONNECT_FENCED_OPTIONS[k] != NULL; k++) {
        if (strcmp(e->key, SCR_TLS_CONNECT_FENCED_OPTIONS[k]) == 0) {
          scr_tls_opt_fence("tls.connect", e->key,
                            "port/host/rejectUnauthorized/ca/servername are the honestly-implemented members of a runtime options record");
          ok = false;
          break;
        }
      }
      /* anything else: an undocumented key, dropped like Node drops it */
    }
  }
  if (ok && port < 0) {
    scr_dyn_arg_type_fail("options.port", "of type number", scr_dyn_undefined());
    ok = false;
  }
  if (!ok) {
    scr_bytes_release(ca);
    scr_bytes_release(session_bytes);
    scr_closure_release(cb);
    scr_dyn_release(ident);
    return NULL;
  }
  ScrStr *dial_host = (ScrStr *)(host != NULL && host->len > 0 ? host : opt_host);
  /* SNI + verification see the servername when given, the host name
   * otherwise (Node's servername default). */
  ScrStr *verify_host = (ScrStr *)(servername != NULL ? servername : dial_host);
  ScrStr *localhost_fallback = NULL;
  if (verify_host == NULL) {
    localhost_fallback = scr_str_new("localhost", 9);
    verify_host = localhost_fallback;
  }
  /* Resolve for the dial only (the http client's rule): verify_host above
   * already holds the NAME, which is what SNI and certificate verification
   * must see. A null dial_host stays null — scr_net_connect's own arm. */
  ScrNetSocket *s =
      scr_net_connect_host(port, dial_host, cb); /* cb fires post-handshake — secureConnect */
  ScrTlsCli *cli = scr_tls_cli_new2(verify_host, reject,
                                     ca != NULL ? (const char *)ca->data : NULL,
                                     ca != NULL ? ca->len : 0, !reject);
  cli->identity = ident;
  ident = NULL;
  if (session_bytes != NULL) {
    /* an undecodable blob is dropped (a full handshake), as Node's d2i does */
    mbedtls_ssl_session *sess = calloc(1, sizeof *sess);
    if (sess == NULL) scr_tls_oom();
    mbedtls_ssl_session_init(sess);
    if (mbedtls_ssl_session_load(sess, session_bytes->data, session_bytes->len) == 0) {
      cli->resume = sess;
    } else {
      mbedtls_ssl_session_free(sess);
      free(sess);
    }
  }
  scr_tls_cli_wrap(s, cli);
  scr_str_release(localhost_fallback);
  scr_bytes_release(ca);
  scr_bytes_release(session_bytes);
  return s;
}

/* ── h2 over TLS (http2.createSecureServer / the https-authority client)
 * — the mbedTLS half: scr_http2.c owns the sessions and calls these two
 * (every http2-using binary links this unit — the moduleUsesTls switch
 * counts http2 libCalls). */

/* Wrap an h2 server: the TLS engine installs per accepted socket, ALPN
 * advertises h2 (plus http/1.1 when the caller wired an inner parser
 * hook first — none today), and on_established attaches the h2 session
 * via `h2_conn` (the ctx moves in with its release fn). */
void scr_tls_server_wrap_h2(ScrNetServer *s, const char *cert, size_t cert_len,
                             const char *key, size_t key_len,
                             ScrNetNativeConnFn h2_conn, void *h2_ctx /*moves*/,
                             void (*h2_ctx_free)(void *)) {
  ScrTlsSrv *srv = scr_tls_srv_new(cert, cert_len, key, key_len, false);
  mbedtls_ssl_conf_alpn_protocols(&srv->conf, SCR_TLS_ALPN_H2);
  srv->h2_conn = h2_conn;
  srv->h2_ctx = h2_ctx;
  srv->h2_ctx_free = h2_ctx_free;
  scr_net_server_get_native_conn(s, &srv->inner_conn, &srv->inner_ctx, &srv->inner_ctx_free);
  scr_net_server_set_native_conn(s, &scr_tls_srv_on_conn, srv, &scr_tls_srv_release_v);
  scr_net_server_defer_connections(s); /* 'connection'/'secureConnection' wait for the handshake */
}

/* The h2-over-TLS CLIENT wrap (http2.connect with an https authority):
 * a client transport offering ALPN ["h2"] — SNI/verification against
 * the authority host; `ca` replaces the trust anchors ("" = none) and
 * reject_unauthorized false records like tls.connect's. The session's
 * preface/SETTINGS ride the socket's write buffer until establishment. */
void scr_tls_h2_client_wrap(ScrNetSocket *sock, ScrStr *host /*borrowed*/,
                             bool reject_unauthorized, const char *ca, size_t ca_len) {
  ScrTlsCli *cli = scr_tls_cli_new2(host, reject_unauthorized, ca, ca_len, !reject_unauthorized);
  mbedtls_ssl_conf_alpn_protocols(&cli->conf, SCR_TLS_ALPN_H2);
  scr_tls_cli_wrap(sock, cli);
}

/* ── the checked-dynamic TLSSocket members (scr_net.c's hook table) ──── */

/* Node's authorizationError: the verify-failure CODE string (null when
 * authorized). Chain errors dominate the identity check — Node records
 * ssl.verifyError() first and only reaches checkServerIdentity's
 * ERR_TLS_CERT_ALTNAME_INVALID on a VERIFIED chain. */
static const char *scr_tls_auth_code(ScrTlsSock *t) {
  uint32_t vr = mbedtls_ssl_get_verify_result(&t->ssl);
  if (t->vrfy_expired) return "CERT_HAS_EXPIRED";
  if (t->vrfy_leaf_self) return "DEPTH_ZERO_SELF_SIGNED_CERT";
  if (t->vrfy_chain_self) return "SELF_SIGNED_CERT_IN_CHAIN";
  if (vr & MBEDTLS_X509_BADCERT_NOT_TRUSTED) return "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
  if (t->vrfy_cn_mismatch) return "ERR_TLS_CERT_ALTNAME_INVALID";
  return "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
}

static ScrTlsSock *scr_tls_sock_of(ScrNetSocket *s) {
  return (ScrTlsSock *)scr_net_sock_transport_ctx_for(s, &SCR_TLS_OPS);
}

/* The client 'session' event. Node 24.15 never emits it on a client
 * TLSSocket: the new-session callback never reaches JS, although the
 * server issues tickets (server newSession fires) and getSession() answers
 * a resumable session (MEASURED, lab/node-sess5.js, node-sess7.js: TLS 1.2
 * and 1.3, ticketKeys, servername, sessionTimeout). So the registration is
 * accepted and never fires, exactly Node's observable behaviour. */
static void scr_tls_fire_session(ScrTlsSock *t) { (void)t; }

/* The negotiated session serialized (mbedtls_ssl_session_save), +1 bytes,
 * or NULL when the handshake has no session. The `session` option and
 * getSession() share this wire form. */
static ScrBytes *scr_tls_session_bytes(ScrTlsSock *t) {
  mbedtls_ssl_session sess;
  mbedtls_ssl_session_init(&sess);
  if (mbedtls_ssl_get_session(&t->ssl, &sess) != 0) {
    mbedtls_ssl_session_free(&sess);
    return NULL;
  }
  size_t need = 0;
  (void)mbedtls_ssl_session_save(&sess, NULL, 0, &need);
  ScrBytes *b = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)need));
  size_t used = 0;
  int ok = mbedtls_ssl_session_save(&sess, b->data, need, &used) == 0;
  mbedtls_ssl_session_free(&sess);
  if (!ok) {
    scr_bytes_release(b);
    return NULL;
  }
  return b;
}

/* Whether the handshake RESUMED the offered session. A resumption leaves the
 * negotiated session carrying the offered identity: the offered RFC 5077 /
 * TLS 1.3 ticket, or the offered TLS 1.2 session id. A full handshake mints a
 * new session with none of the offered identity (its ticket arrives after the
 * handshake, and a server never reuses a fresh id). Checked once, at handshake
 * completion, with no export (see the MBEDTLS_ALLOW_PRIVATE_ACCESS note). */
static bool scr_tls_resumed(ScrTlsSock *t) {
  const mbedtls_ssl_session *o = t->cli != NULL ? t->cli->resume : NULL;
  const mbedtls_ssl_session *n = t->ssl.MBEDTLS_PRIVATE(session);
  if (o == NULL || n == NULL) return false;
  if (o->MBEDTLS_PRIVATE(ticket_len) > 0 &&
      n->MBEDTLS_PRIVATE(ticket_len) == o->MBEDTLS_PRIVATE(ticket_len) &&
      memcmp(n->MBEDTLS_PRIVATE(ticket), o->MBEDTLS_PRIVATE(ticket), o->MBEDTLS_PRIVATE(ticket_len)) == 0) {
    return true;
  }
  return o->MBEDTLS_PRIVATE(id_len) > 0 && n->MBEDTLS_PRIVATE(id_len) == o->MBEDTLS_PRIVATE(id_len) &&
         memcmp(n->MBEDTLS_PRIVATE(id), o->MBEDTLS_PRIVATE(id), o->MBEDTLS_PRIVATE(id_len)) == 0;
}

/* The STATIC-lane TLSSocket members (the lowered socket surface). */

/* TLSSocket.isSessionReused(): true iff the handshake resumed the offered session. */
bool scr_tls_sock_session_reused(ScrNetSocket *s) {
  ScrTlsSock *t = scr_tls_sock_of(s);
  return t != NULL && t->established && t->resumed;
}

/* TLSSocket.getSession(): the serialized session (+1), or NULL (Node's undefined)
 * when there is none: a server socket, or a client whose handshake has not
 * completed. */
ScrBytes *scr_tls_sock_get_session(ScrNetSocket *s) {
  ScrTlsSock *t = scr_tls_sock_of(s);
  if (t == NULL || !t->established || t->cli == NULL) return NULL;
  return scr_tls_session_bytes(t);
}

/* getPeerCertificate(): the peer's certificate object, or {} (no peer
 * certificate yet, or none presented). Node's `detailed` flag changes nothing
 * the peer chain can show here: both answer the same members. */
ScrDyn *scr_tls_sock_peer_cert(ScrNetSocket *s, bool detailed) {
  (void)detailed;
  ScrTlsSock *t = scr_tls_sock_of(s);
  const mbedtls_x509_crt *crt = t != NULL ? mbedtls_ssl_get_peer_cert(&t->ssl) : NULL;
  if (crt == NULL) return scr_dyn_new_obj();
  return scr_tls_cert_obj(crt, crt, 0);
}


bool scr_tls_sock_authorized(ScrNetSocket *s) {
  ScrTlsSock *t = scr_tls_sock_of(s);
  return t != NULL && t->established && t->cli != NULL && t->cli->verify_recorded &&
         mbedtls_ssl_get_verify_result(&t->ssl) == 0;
}

ScrStr *scr_tls_sock_auth_error(ScrNetSocket *s) {
  ScrTlsSock *t = scr_tls_sock_of(s);
  if (t == NULL || !t->established || t->cli == NULL || !t->cli->verify_recorded ||
      mbedtls_ssl_get_verify_result(&t->ssl) == 0) {
    return NULL; /* the null arm — authorized, or never verified */
  }
  const char *code = scr_tls_auth_code(t);
  return scr_str_new(code, strlen(code));
}

void scr_tls_sock_on_secure_connect(ScrNetSocket *s, ScrClosure *cb /*moves*/, bool once) {
  if (scr_tls_sock_of(s) == NULL) {
    scr_closure_release(cb); /* a plain socket never fires it, like Node */
    return;
  }
  scr_net_sock_on_connect(s, cb, once); /* fires at establishment — secureConnect timing */
}

void scr_tls_sock_on_session(ScrNetSocket *s, ScrClosure *cb /*moves*/, void *fn, bool once) {
  ScrTlsSock *t = scr_tls_sock_of(s);
  if (t == NULL) {
    scr_closure_release(cb); /* a plain socket never fires it, like Node */
    return;
  }
  scr_net_ls_add(&t->session_ls, cb, fn, once);
  if (t->established) scr_tls_fire_session(t); /* the ticket already arrived */
}

static bool scr_tls_dynh_get(ScrNetSocket *s, const char *key, ScrDyn **out) {
  ScrTlsSock *t = scr_tls_sock_of(s);
  if (t == NULL) return false; /* a plain socket: the net dispatch answers */
  if (strcmp(key, "authorized") == 0) {
    bool a = t->established && t->cli != NULL && t->cli->verify_recorded &&
             mbedtls_ssl_get_verify_result(&t->ssl) == 0;
    *out = scr_dyn_new_bool(a);
    return true;
  }
  if (strcmp(key, "authorizationError") == 0) {
    if (!t->established || t->cli == NULL || !t->cli->verify_recorded ||
        mbedtls_ssl_get_verify_result(&t->ssl) == 0) {
      *out = scr_dyn_new_null();
      return true;
    }
    const char *code = scr_tls_auth_code(t);
    ScrStr *str = scr_str_new(code, strlen(code));
    *out = scr_dyn_new_str(str);
    scr_str_release(str);
    return true;
  }
  return false;
}

static bool scr_tls_dynh_on(ScrNetSocket *s, const char *event, const ScrDyn *cb, bool once) {
  ScrTlsSock *t = scr_tls_sock_of(s);
  if (t == NULL) return false;
  if (strcmp(event, "secureConnect") == 0) {
    /* a TLS socket's 'connect' list fires at establishment — exactly
     * Node's secureConnect timing (scr_net.c's transport pump) */
    scr_net_sock_on_connect(s, scr_dyn_listener_closure0(cb), once);
    return true;
  }
  if (strcmp(event, "session") == 0) {
    scr_net_ls_add(&t->session_ls, scr_dyn_listener_closure_data(cb),
                   (void *)&scr_dyn_listener_fire_data, once);
    /* a late registration on an established socket fires directly (the
     * ticket already arrived — nothing further would trigger it) */
    if (t->established) scr_tls_fire_session(t);
    return true;
  }
  return false;
}

static bool scr_tls_dynh_invoke(ScrNetSocket *s, const char *method, ScrDyn *const *args,
                                 size_t argc, ScrDyn **out) {
  (void)args;
  (void)argc;
  if (scr_tls_sock_of(s) == NULL) return false;
  /* the members a dynamic receiver answers with the same values the static
   * lowering does (scr_tls_sock_peer_cert, _session_reused, _get_session) */
  if (strcmp(method, "getPeerCertificate") == 0) {
    *out = scr_tls_sock_peer_cert(s, argc > 0 && scr_tls_dyn_truthy(args[0]));
    return true;
  }
  if (strcmp(method, "isSessionReused") == 0) {
    *out = scr_dyn_new_bool(scr_tls_sock_session_reused(s));
    return true;
  }
  if (strcmp(method, "getSession") == 0) {
    ScrBytes *b = scr_tls_sock_get_session(s);
    if (b == NULL) {
      *out = scr_dyn_undefined();
    } else {
      *out = scr_dyn_new_buffer_copy(b);
      scr_bytes_release(b);
    }
    return true;
  }
  static const char *const tls_methods[] = {
    "getCertificate", "getCipher", "getProtocol",
    "getTLSTicket", "getEphemeralKeyInfo", "getFinished", "getPeerFinished",
    "getSharedSigalgs", "getPeerX509Certificate", "getX509Certificate",
    "exportKeyingMaterial", "renegotiate", "setMaxSendFragment",
    "enableTrace", "disableRenegotiation", "setServername", "setSession", NULL,
  };
  for (size_t i = 0; tls_methods[i] != NULL; i++) {
    if (strcmp(method, tls_methods[i]) == 0) {
      char msg[160];
      int n = snprintf(msg, sizeof msg,
                       "'TLSSocket.prototype.%s' on a dynamic value is not supported yet", method);
      scr_throw_error_msg(SCR_ERR_ERROR, msg, (size_t)n);
      *out = NULL;
      return true;
    }
  }
  return false;
}

static const ScrNetDynhTlsHooks SCR_TLS_DYNH = {
  &scr_tls_dynh_get,
  &scr_tls_dynh_on,
  &scr_tls_dynh_invoke,
};

/* `u instanceof tls.TLSSocket` on an unknown value (the lowering's tls.dynInstanceOf).
 * A TLSSocket is a net-socket handle carrying a TLS transport from construction
 * (scr_net_sock_set_transport), and the transport is never detached, so the encrypted
 * flag decides the class. A plain net.Socket, a server, or any other kind answers false. */
bool scr_tls_dyn_instanceof(const ScrDyn *d) {
  if (!scr_dyn_handle_is(d, SCR_DYNH_NET_SOCKET)) return false;
  return scr_net_sock_encrypted((ScrNetSocket *)d->v.handle.ptr);
}
