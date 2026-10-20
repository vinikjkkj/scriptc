/* scr_rsa_pubenc.c -- crypto.publicEncrypt, ONE shape: RSA public key,
 * PKCS#1 v2.1 OAEP padding, SHA-1 MGF1/label hash, empty label. This is
 * the shape mysql2's caching_sha2_password and sha256_password auth
 * plugins use (crypto.publicEncrypt({ key, oaepHash: 'sha1'[, padding:
 * crypto.constants.RSA_PKCS1_OAEP_PADDING] }, stage1) -- OAEP is Node's
 * documented default padding for publicEncrypt, so the plugin that omits
 * it resolves to the identical operation as the one that spells it out).
 *
 * Deliberately NOT a KeyObject: the operation is one-shot and stateless
 * -- the caller hands a fresh PEM/DER buffer every time and never retains
 * a key value across calls for this path. A faithful general publicEncrypt
 * (arbitrary padding, arbitrary hash, a KeyObject input alongside a raw
 * buffer) is a different, larger piece of work; this unit does not
 * attempt it; see surfaces.ts's refusal table for every other shape.
 *
 * The RSA/PK/bignum math and the PEM parser come from the vendored
 * mbedTLS (vendor/mbedtls/library/{rsa,pk,pkparse}.c) -- compiled into
 * every TLS-using and WebRTC-using binary already (cc.ts's
 * ensureTlsArchive builds every library/*.c unconditionally, no
 * per-feature exclusion), used here for the first time outside the
 * WebRTC DTLS identity (scr_wrtc_cert.c, ECDSA P-256) and the TLS client
 * (scr_tls.c). The CTR_DRBG pattern below is the same shape as both of
 * those: lazily seed one process-wide DRBG from OS entropy, free never
 * (process-lifetime, like scr_tls.c's).
 *
 * FAILURE SHAPE -- catchable, not a trap. The RSA public key here is the
 * REMOTE MySQL server's, not local configuration (unlike tls.createServer's
 * own cert/key, which stays a print-and-die construction-time trap because
 * it is operator-supplied). A broken, misconfigured or hostile server can
 * hand this unit garbage, a non-RSA key, or a key too small for the
 * plaintext -- exactly the shape commit range 43bae03e0..6a66b3c4f fixed
 * for sc_bad_key (a remote-reachable uncatchable abort), fire-tested there
 * with a live HTTP request that came back 500 with the process alive. All
 * three failure modes below throw a catchable Error via
 * scr_throw_error_fmt_code (scr_error.c's scr_trap_fmt twin -- vsnprintf
 * into scr_throw_error_msg_code instead of abort()), naming the call site
 * (sc_site, baked as a literal by both backends from the IR libCall's own
 * loc -- the recordKeyGetHelper/sc_bad_key shape: one shared runtime
 * symbol serves every publicEncrypt call site in a program, so it cannot
 * name the one that failed unless the site rides in as data) and carrying
 * the SAME `.code` string Node's own OpenSSL-backed implementation uses
 * (measured against node v22.18.0, not guessed), so
 * `catch (e) { e.code === "ERR_OSSL_..." }` matches real Node. Every
 * helper RETURNS a NULL dummy after throwing -- the pending flag is what
 * the generated call site's emitPendingCheck tests, exactly like
 * recordKeyGetHelper's own miss path. */

#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "mbedtls/ctr_drbg.h"
#include "mbedtls/entropy.h"
#include "mbedtls/error.h"
#include "mbedtls/pk.h"
#include "mbedtls/rsa.h"

static mbedtls_entropy_context scr_rsa_pubenc_entropy;
static mbedtls_ctr_drbg_context scr_rsa_pubenc_drbg;
static bool scr_rsa_pubenc_rng_ready = false;

static void scr_rsa_pubenc_rng_init(void) {
  if (scr_rsa_pubenc_rng_ready) return;
  mbedtls_entropy_init(&scr_rsa_pubenc_entropy);
  mbedtls_ctr_drbg_init(&scr_rsa_pubenc_drbg);
  static const char pers[] = "scr-rsa-pubenc";
  if (mbedtls_ctr_drbg_seed(&scr_rsa_pubenc_drbg, mbedtls_entropy_func,
                            &scr_rsa_pubenc_entropy, (const unsigned char *)pers,
                            sizeof pers - 1) != 0) {
    /* RNG seeding failure is OS-entropy exhaustion, not remote input --
     * every other unit in this runtime that seeds a DRBG (scr_tls.c,
     * scr_wrtc_cert.c) traps on this too; not part of this conversion. */
    scr_trap("scriptc: crypto: RNG seeding failed\n");
  }
  scr_rsa_pubenc_rng_ready = true;
}

/* scr_throw_error_fmt_code is scr_trap_fmt's catchable twin (scr_error.c):
 * vsnprintf into scr_throw_error_msg_code instead of abort(). `kind` is
 * SCR_ERR_ERROR for all three throws below -- Node's own OpenSSL-backed
 * publicEncrypt raises a plain `Error` for every one of these (measured:
 * e.constructor.name is "Error" for a garbage key, a non-RSA key, and an
 * OAEP-too-long input against node v22.18.0), never a TypeError. */

/* PEM/DER key bytes plus the plaintext, OAEP/SHA-1/empty-label encrypt.
 * Fully ephemeral: the mbedtls_pk_context lives on this function's stack
 * and is freed before it returns -- nothing it touches outlives the call,
 * so there is no refcounting and nothing resembling a KeyObject. Returns
 * NULL (with a pending exception) on any of the three catchable failure
 * modes; the caller's generated code checks the pending flag before using
 * the result, exactly like every other MAY_THROW_LIB_FNS member. */
static ScrBytes *scr_rsa_pubenc_core(const unsigned char *key, size_t key_len,
                                     const unsigned char *data, size_t data_len,
                                     const char *sc_site) {
  scr_rsa_pubenc_rng_init();

  mbedtls_pk_context pk;
  mbedtls_pk_init(&pk);

  /* mbedtls_pk_parse_public_key wants PEM text NUL-terminated with the
   * NUL counted in the length (DER tolerates the extra byte); the key
   * bytes here come from a scriptc value that is not itself
   * NUL-terminated, so this always makes its own terminated copy -- same
   * discipline as scr_tls.c's parse_key/parse_crt. */
  unsigned char *buf = malloc(key_len + 1);
  if (!buf) scr_trap("scriptc: out of memory\n"); /* OOM, not remote input */
  memcpy(buf, key, key_len);
  buf[key_len] = 0;
  int r = mbedtls_pk_parse_public_key(&pk, buf, key_len + 1);
  free(buf);
  if (r != 0) {
    mbedtls_pk_free(&pk);
    char detail[128];
    mbedtls_strerror(r, detail, sizeof detail);
    scr_throw_error_fmt_code(
      SCR_ERR_ERROR, "ERR_OSSL_UNSUPPORTED",
      "scriptc: Error: error:1E08010C:DECODER routines::unsupported -- failed to parse an "
      "RSA public key (%s) (crypto.publicEncrypt at %s)\n",
      detail, sc_site);
    return NULL;
  }

  if (mbedtls_pk_get_type(&pk) != MBEDTLS_PK_RSA) {
    mbedtls_pk_free(&pk);
    scr_throw_error_fmt_code(
      SCR_ERR_ERROR, "ERR_OSSL_EVP_OPERATION_NOT_SUPPORTED_FOR_THIS_KEYTYPE",
      "scriptc: Error: error:03000096:digital envelope routines::operation not supported for "
      "this keytype -- key is not an RSA public key (crypto.publicEncrypt at %s)\n",
      sc_site);
    return NULL;
  }

  mbedtls_rsa_context *rsa = mbedtls_pk_rsa(pk);
  r = mbedtls_rsa_set_padding(rsa, MBEDTLS_RSA_PKCS_V21, MBEDTLS_MD_SHA1);
  if (r != 0) {
    /* Unreachable with this unit's fixed (OAEP, SHA-1) arguments on any
     * build this runtime ships -- MBEDTLS_MD_SHA1 is unconditionally on
     * (mbedtls_config.h), so this can only fail if a future vendor bump
     * disables it. Not remote-triggerable, but it costs nothing to make
     * catchable rather than reintroduce a trap on this path. */
    mbedtls_pk_free(&pk);
    char detail[128];
    mbedtls_strerror(r, detail, sizeof detail);
    scr_throw_error_fmt_code(
      SCR_ERR_ERROR, "ERR_CRYPTO_OPERATION_FAILED",
      "scriptc: Error: failed to configure RSA-OAEP padding (%s) (crypto.publicEncrypt at %s)\n",
      detail, sc_site);
    return NULL;
  }

  size_t out_len = mbedtls_rsa_get_len(rsa);
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)out_len);

  r = mbedtls_rsa_rsaes_oaep_encrypt(rsa, mbedtls_ctr_drbg_random, &scr_rsa_pubenc_drbg,
                                     NULL, 0, data_len, data, out->data);
  mbedtls_pk_free(&pk);
  if (r != 0) {
    scr_bytes_release(out); /* allocated before the encrypt attempt;
                              * release it here instead of leaking it. */
    char detail[128];
    mbedtls_strerror(r, detail, sizeof detail);
    /* The one failure mbedtls_rsa_rsaes_oaep_encrypt actually returns for
     * ilen too large (MBEDTLS_ERR_RSA_BAD_INPUT_DATA) is also what it
     * returns for a few other malformed-call shapes this unit never
     * produces (this unit always supplies a valid ctx/rng), so in
     * practice this path is the too-large-input one -- matching Node's
     * own ERR_OSSL_RSA_DATA_TOO_LARGE_FOR_KEY_SIZE (measured against
     * node v22.18.0: a 200-byte plaintext against a 512-bit test key). */
    scr_throw_error_fmt_code(
      SCR_ERR_ERROR, "ERR_OSSL_RSA_DATA_TOO_LARGE_FOR_KEY_SIZE",
      "scriptc: Error: error:0200006E:rsa routines::data too large for key size (%s) "
      "(crypto.publicEncrypt at %s)\n",
      detail, sc_site);
    return NULL;
  }

  /* Node: publicEncrypt answers a Buffer. */
  return scr_bytes_stamp_buffer(out);
}

/* The two static input shapes the compiler admits for `key`: a PEM
 * string, or a Buffer (mysql2 always passes the latter -- the server's
 * public-key packet is a wire Buffer -- but the string form is the same
 * operation and costs nothing extra to support faithfully). `data` is
 * always a Buffer (Node throws on a string plaintext here too, same as
 * every other Buffer-only crypto surface already lowered in this
 * runtime). `sc_site` is a "file:line:col" literal baked by the emitter
 * from the IR libCall's own loc (both backends: emit-exprs.ts's finish()
 * callers pass it as a third C-string-literal argument, llvm/emitter.ts
 * interns it with this.cstr(srcSite(e.loc)) -- the identical shape
 * recordKeyGetHelper/sc_bad_key already use for a shared, call-site-naming
 * runtime symbol). Borrowed in, +1 out, NULL + pending on failure. */
ScrBytes *scr_rsa_public_encrypt_oaep_sha1_str_key(ScrStr *key, ScrBytes *data, const char *sc_site) {
  return scr_rsa_pubenc_core((const unsigned char *)key->data, key->len, data->data,
                             data->len * scr_bytes_elem_size(data->elem), sc_site);
}

ScrBytes *scr_rsa_public_encrypt_oaep_sha1_bytes_key(ScrBytes *key, ScrBytes *data, const char *sc_site) {
  return scr_rsa_pubenc_core(key->data, key->len * scr_bytes_elem_size(key->elem), data->data,
                             data->len * scr_bytes_elem_size(data->elem), sc_site);
}
