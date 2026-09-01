/* Does the generated certificate actually work as a DTLS identity?
 *
 * Not "does the call return non-NULL". The checks here are the ones that
 * would catch a certificate that looks fine and fails at handshake time:
 * it must PARSE back through mbedtls's own X.509 reader, be self-signed
 * with a P-256 key, and its fingerprint must be the SHA-256 of exactly the
 * DER bytes we would put on the wire.
 */
#include <stdio.h>
#include <string.h>

#include "mbedtls/x509_crt.h"

#include "scr_wrtc_cert.h"
#include "scr_wrtc_fp.h"

static int fails = 0, checks = 0;
static void ck(const char *what, bool ok, const char *detail) {
  checks++;
  if (ok) printf("  ok   %-52s %s\n", what, detail ? detail : "");
  else { printf("  FAIL %-52s %s\n", what, detail ? detail : ""); fails++; }
}

int main(void) {
  printf("ephemeral self-signed DTLS certificate (ECDSA P-256)\n");

  ScrWrtcCert *c = scr_wrtc_cert_generate();
  ck("generates", c != NULL, NULL);
  if (c == NULL) { printf("RESULT: FAIL\n"); return 1; }

  size_t der_len = 0;
  const uint8_t *der = scr_wrtc_cert_der(c, &der_len);
  char sz[64]; snprintf(sz, sizeof sz, "%zu bytes", der_len);
  ck("has DER bytes", der != NULL && der_len > 100 && der_len < 4096, sz);

  /* A real DER SEQUENCE starts with 0x30. If write_crt_der's fill-from-the-
   * end had been mishandled, the fingerprint would still be 32 plausible
   * bytes and only this catches it. */
  ck("DER begins with a SEQUENCE tag", der != NULL && der[0] == 0x30, NULL);

  /* Parse it back with mbedtls's own reader — the same code path the PEER
   * will use. */
  mbedtls_x509_crt parsed;
  mbedtls_x509_crt_init(&parsed);
  int rc = mbedtls_x509_crt_parse_der(&parsed, der, der_len);
  char rcs[32]; snprintf(rcs, sizeof rcs, "rc=%d", rc);
  ck("parses back through mbedtls x509", rc == 0, rcs);

  if (rc == 0) {
    ck("key is ECDSA/ECKEY",
       mbedtls_pk_can_do(&parsed.pk, MBEDTLS_PK_ECDSA), NULL);
    const mbedtls_ecp_keypair *ec = mbedtls_pk_ec(parsed.pk);
    ck("curve is P-256 (secp256r1)",
       ec != NULL && mbedtls_pk_get_bitlen(&parsed.pk) == 256, NULL);
    /* Self-signed: issuer and subject must be the same name. */
    ck("issuer equals subject (self-signed)",
       parsed.issuer_raw.len == parsed.subject_raw.len &&
       memcmp(parsed.issuer_raw.p, parsed.subject_raw.p, parsed.issuer_raw.len) == 0,
       NULL);
    /* Verify the SELF-SIGNATURE through the public API rather than
     * reading MBEDTLS_PRIVATE(sig_md): a field says what the certificate
     * CLAIMS, verification says the signature actually checks out with
     * this key. The cert is offered as its own trust root; a self-signed
     * leaf is legitimately NOT_TRUSTED as a CA (no basicConstraints
     * CA:TRUE), so that one flag is expected and any OTHER flag -- above
     * all BADCERT_NOT_TRUSTED's neighbours for a bad signature -- is a
     * real failure. */
    uint32_t flags = 0;
    int vrc = mbedtls_x509_crt_verify(&parsed, &parsed, NULL, NULL, &flags,
                                      NULL, NULL);
    char vs[64];
    snprintf(vs, sizeof vs, "rc=%d flags=0x%08X", vrc, (unsigned)flags);
    ck("self-signature verifies (only NOT_TRUSTED tolerated)",
       (flags & ~(uint32_t)MBEDTLS_X509_BADCERT_NOT_TRUSTED) == 0, vs);
  }
  mbedtls_x509_crt_free(&parsed);

  /* The fingerprint must be SHA-256 over EXACTLY these DER bytes — the
   * value this endpoint advertises and the peer checks. */
  uint8_t fp[32], direct[32];
  ck("computes its fingerprint", scr_wrtc_cert_fingerprint(c, fp), NULL);
  ck("fingerprint is SHA-256 of the DER we would send",
     scr_wrtc_fp_of_cert(der, der_len, direct) && scr_wrtc_fp_equal(fp, direct), NULL);

  char text[96];
  scr_wrtc_fp_format(fp, text);
  printf("       advertised: a=fingerprint:sha-256 %.23s...\n", text);

  /* Round trip through the SDP spelling the peer would receive. */
  char line[160];
  snprintf(line, sizeof line, "sha-256 %s", text);
  uint8_t reparsed[32];
  ck("round-trips through the SDP spelling",
     scr_wrtc_fp_parse(line, strlen(line), reparsed) &&
     scr_wrtc_fp_equal(fp, reparsed), NULL);

  /* Ephemeral means a DIFFERENT key each time. Two certificates that share
   * a fingerprint would mean the RNG is not seeding, which is the failure
   * that looks like everything working. */
  ScrWrtcCert *c2 = scr_wrtc_cert_generate();
  ck("generates a second", c2 != NULL, NULL);
  if (c2 != NULL) {
    uint8_t fp2[32];
    scr_wrtc_cert_fingerprint(c2, fp2);
    ck("two certificates have DIFFERENT fingerprints",
       !scr_wrtc_fp_equal(fp, fp2), "ephemeral, not a fixed key");
    scr_wrtc_cert_free(c2);
  }

  scr_wrtc_cert_free(c);
  printf("\n%d checks, %d failures\nRESULT: %s\n", checks, fails, fails ? "FAIL" : "PASS");
  return fails ? 1 : 0;
}
