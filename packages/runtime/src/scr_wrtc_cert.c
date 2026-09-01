/* scr_wrtc_cert.c — see the header for why this is ephemeral and self-signed. */

#include <stdlib.h>
#include <string.h>

#include "mbedtls/ctr_drbg.h"
#include "mbedtls/entropy.h"
#include "mbedtls/pk.h"
#include "mbedtls/x509_crt.h"
#include "mbedtls/x509_csr.h"

#include "scr_wrtc_cert.h"
#include "scr_wrtc_fp.h"

struct ScrWrtcCert {
  mbedtls_pk_context key;
  mbedtls_entropy_context entropy;
  mbedtls_ctr_drbg_context drbg;
  uint8_t *der;
  size_t der_len;
};

void scr_wrtc_cert_free(ScrWrtcCert *c) {
  if (c == NULL) return;
  mbedtls_pk_free(&c->key);
  mbedtls_ctr_drbg_free(&c->drbg);
  mbedtls_entropy_free(&c->entropy);
  free(c->der);
  free(c);
}

ScrWrtcCert *scr_wrtc_cert_generate(void) {
  ScrWrtcCert *c = calloc(1, sizeof *c);
  if (c == NULL) return NULL;
  mbedtls_pk_init(&c->key);
  mbedtls_entropy_init(&c->entropy);
  mbedtls_ctr_drbg_init(&c->drbg);

  static const char pers[] = "scr-wrtc-cert";
  if (mbedtls_ctr_drbg_seed(&c->drbg, mbedtls_entropy_func, &c->entropy,
                            (const unsigned char *)pers, sizeof pers - 1) != 0)
    goto fail;

  if (mbedtls_pk_setup(&c->key, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY)) != 0)
    goto fail;
  if (mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(c->key),
                          mbedtls_ctr_drbg_random, &c->drbg) != 0)
    goto fail;

  mbedtls_x509write_cert crt;
  mbedtls_x509write_crt_init(&crt);
  mbedtls_x509write_crt_set_version(&crt, MBEDTLS_X509_CRT_VERSION_3);
  mbedtls_x509write_crt_set_md_alg(&crt, MBEDTLS_MD_SHA256);
  /* Self-signed: subject and issuer are the same key and the same name.
   * The name is not authenticated by anything and browsers do not read it;
   * WebRTC identity is the fingerprint alone. */
  mbedtls_x509write_crt_set_subject_key(&crt, &c->key);
  mbedtls_x509write_crt_set_issuer_key(&crt, &c->key);
  bool ok = mbedtls_x509write_crt_set_subject_name(&crt, "CN=WebRTC") == 0 &&
            mbedtls_x509write_crt_set_issuer_name(&crt, "CN=WebRTC") == 0;
  /* A fixed serial and a wide validity window: the certificate lives as
   * long as the peer connection and is authenticated out of band, so
   * neither field carries meaning here. Expiry still has to PARSE, which
   * is why it is a real date rather than zeroes. */
  if (ok) {
    mbedtls_mpi serial;
    mbedtls_mpi_init(&serial);
    ok = mbedtls_mpi_lset(&serial, 1) == 0 &&
         mbedtls_x509write_crt_set_serial(&crt, &serial) == 0;
    mbedtls_mpi_free(&serial);
  }
  if (ok) ok = mbedtls_x509write_crt_set_validity(&crt, "20240101000000", "20340101000000") == 0;

  unsigned char buf[4096];
  int n = -1;
  if (ok) {
    /* write_crt_der fills the buffer from the END and returns the length,
     * so the DER starts at buf + sizeof(buf) - n, not at buf. Getting this
     * wrong yields a fingerprint over leading garbage that still looks
     * like a plausible 32-byte hash. */
    n = mbedtls_x509write_crt_der(&crt, buf, sizeof buf,
                                  mbedtls_ctr_drbg_random, &c->drbg);
  }
  mbedtls_x509write_crt_free(&crt);
  if (n <= 0) goto fail;

  c->der = malloc((size_t)n);
  if (c->der == NULL) goto fail;
  memcpy(c->der, buf + sizeof buf - (size_t)n, (size_t)n);
  c->der_len = (size_t)n;
  return c;

fail:
  scr_wrtc_cert_free(c);
  return NULL;
}

const uint8_t *scr_wrtc_cert_der(const ScrWrtcCert *c, size_t *len) {
  if (c == NULL) return NULL;
  if (len != NULL) *len = c->der_len;
  return c->der;
}

void *scr_wrtc_cert_pk(const ScrWrtcCert *c) {
  if (c == NULL) return NULL;
  /* Cast away const: mbedtls's signing path needs a mutable context, and
   * the cert owns this key for its whole lifetime. */
  return (void *)&((ScrWrtcCert *)c)->key;
}

bool scr_wrtc_cert_fingerprint(const ScrWrtcCert *c, uint8_t out[32]) {
  if (c == NULL || c->der == NULL) return false;
  return scr_wrtc_fp_of_cert(c->der, c->der_len, out);
}
