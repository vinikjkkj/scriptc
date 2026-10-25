/* scr_rsa_pubenc.c -- crypto.publicEncrypt, object form, every padding and
 * hash the surface accepts: publicEncrypt({ key, oaepHash?, oaepLabel?,
 * padding? }, data). The key, the data and the label are checked-dynamic
 * values (ScrDyn), so the same entry serves a PEM string, a Buffer, and an
 * untyped value that holds either -- Node takes each as a string or any
 * ArrayBufferView, and a PEM string is the utf8 bytes of the same text.
 *
 * Padding is Node's crypto.constants value: 4 RSA_PKCS1_OAEP_PADDING (the
 * default), 1 RSA_PKCS1_PADDING, 3 RSA_NO_PADDING. oaepHash is 1 sha1
 * (the default), 2 sha256, 3 sha384 or 4 sha512; oaepLabel is an empty
 * label when absent. oaepHash and oaepLabel only apply to OAEP, and
 * the RSA math is the vendored mbedTLS one.
 *
 * Key material may be a public key (SPKI/PKCS#1 PEM or DER) or a private
 * key, whose public part is used -- Node accepts both, measured against
 * $NODE_CI.
 *
 * FAILURE SHAPE -- catchable, not a trap. The RSA key is the REMOTE MySQL
 * server's, not local configuration, so a broken or hostile peer can hand
 * this unit garbage, a non-RSA key, or a key too small for the input. Every
 * failure throws a catchable Error whose message and `.code` are Node's own
 * (the OpenSSL text Node prints, measured against $NODE_CI). The wrong-type
 * checks (a key, a data or a label that is not a string or ArrayBufferView)
 * throw Node's TypeError ERR_INVALID_ARG_TYPE wording, which names
 * "key.key" and "key.oaepLabel" as properties and "buffer" as the argument.
 * Every helper RETURNS a NULL dummy after throwing -- the pending flag is
 * what the generated call site's emitPendingCheck tests. */

#include "scr_runtime.h"

#include <stdlib.h>
#include <string.h>

#include "mbedtls/ctr_drbg.h"
#include "mbedtls/entropy.h"
#include "mbedtls/md.h"
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
     * scr_wrtc_cert.c) traps on this too. */
    scr_trap("scriptc: crypto: RNG seeding failed\n");
  }
  scr_rsa_pubenc_rng_ready = true;
}

/* Node's own wording for each failure (measured against $NODE_CI). */
static void scr_rsa_pubenc_throw(const char *msg, const char *code) {
  scr_throw_error_msg_code(SCR_ERR_ERROR, msg, strlen(msg), code);
}

static const char scr_rsa_pubenc_key_expect[] =
    "of type string or an instance of ArrayBuffer, Buffer, TypedArray, DataView, KeyObject, or CryptoKey";
static const char scr_rsa_pubenc_bytes_expect[] =
    "of type string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView";

/* A string (utf8) or any ArrayBufferView, +1 u8 bytes. Anything else throws
 * ERR_INVALID_ARG_TYPE: as a property (prop != 0) or as an argument. */
static ScrBytes *scr_rsa_pubenc_input(const ScrDyn *v, int prop, const char *name, const char *expect) {
  if (v->kind == SCR_DYN_STR || v->kind == SCR_DYN_BYTES) return scr_crypto_input_bytes(v);
  if (prop) scr_dyn_prop_type_fail(name, expect, v);
  else scr_dyn_arg_type_fail(name, expect, v);
  return NULL;
}

static mbedtls_md_type_t scr_rsa_pubenc_md(double hash) {
  if (hash == 2) return MBEDTLS_MD_SHA256;
  if (hash == 3) return MBEDTLS_MD_SHA384;
  if (hash == 4) return MBEDTLS_MD_SHA512;
  return MBEDTLS_MD_SHA1;
}

ScrBytes *scr_rsa_public_encrypt(const ScrDyn *key, const ScrDyn *data, double padding, double hash,
                                 const ScrDyn *label) {
  scr_rsa_pubenc_rng_init();

  /* Node validates the key first: its wrong-type TypeError precedes the
   * data check, and a bad PEM is an OpenSSL error. */
  ScrBytes *kb = scr_rsa_pubenc_input(key, 1, "key.key", scr_rsa_pubenc_key_expect);
  if (kb == NULL) return NULL;
  ScrBytes *db = scr_rsa_pubenc_input(data, 0, "buffer", scr_rsa_pubenc_bytes_expect);
  if (db == NULL) {
    scr_bytes_release(kb);
    return NULL;
  }
  /* Node reads oaepLabel only when it is not undefined: an undefined label is
   * the absent (empty) one. */
  if (label != NULL && label->kind == SCR_DYN_UNDEF) label = NULL;
  ScrBytes *lb = NULL;
  if (label != NULL) {
    lb = scr_rsa_pubenc_input(label, 1, "key.oaepLabel", scr_rsa_pubenc_bytes_expect);
    if (lb == NULL) {
      scr_bytes_release(db);
      scr_bytes_release(kb);
      return NULL;
    }
  }

  /* mbedtls_pk_parse_* wants PEM text NUL-terminated with the NUL counted
   * in the length (DER tolerates the extra byte). The key bytes here are a
   * scriptc value that is not NUL-terminated, so this makes its own copy. */
  size_t klen = kb->len;
  unsigned char *buf = malloc(klen + 1);
  if (!buf) scr_trap("scriptc: out of memory\n"); /* OOM, not remote input */
  if (klen > 0) memcpy(buf, kb->data, klen);
  buf[klen] = 0;
  scr_bytes_release(kb);

  mbedtls_pk_context pk;
  mbedtls_pk_init(&pk);
  int r = mbedtls_pk_parse_public_key(&pk, buf, klen + 1);
  if (r != 0) {
    /* A PEM private key is accepted too (its public part is used). */
    mbedtls_pk_free(&pk);
    mbedtls_pk_init(&pk);
    r = mbedtls_pk_parse_key(&pk, buf, klen + 1, NULL, 0, mbedtls_ctr_drbg_random, &scr_rsa_pubenc_drbg);
  }
  free(buf);
  if (r != 0) {
    mbedtls_pk_free(&pk);
    scr_bytes_release(db);
    if (lb) scr_bytes_release(lb);
    scr_rsa_pubenc_throw("error:1E08010C:DECODER routines::unsupported", "ERR_OSSL_UNSUPPORTED");
    return NULL;
  }

  if (mbedtls_pk_get_type(&pk) != MBEDTLS_PK_RSA) {
    mbedtls_pk_free(&pk);
    scr_bytes_release(db);
    if (lb) scr_bytes_release(lb);
    scr_rsa_pubenc_throw(
        "error:03000096:digital envelope routines::operation not supported for this keytype",
        "ERR_OSSL_EVP_OPERATION_NOT_SUPPORTED_FOR_THIS_KEYTYPE");
    return NULL;
  }

  mbedtls_rsa_context *rsa = mbedtls_pk_rsa(pk);
  size_t k = mbedtls_rsa_get_len(rsa);
  size_t dlen = db->len;
  const unsigned char *ddata = db->data;
  ScrBytes *out = NULL;

  if (padding == 4) {
    /* OAEP: the hash drives MGF1 and the label hash; an input longer than
     * k - 2*hLen - 2 is the too-large failure. */
    r = mbedtls_rsa_set_padding(rsa, MBEDTLS_RSA_PKCS_V21, scr_rsa_pubenc_md(hash));
    if (r == 0) {
      out = scr_bytes_new(SCR_BYTES_U8, (double)k);
      r = mbedtls_rsa_rsaes_oaep_encrypt(rsa, mbedtls_ctr_drbg_random, &scr_rsa_pubenc_drbg,
                                         lb ? lb->data : NULL, lb ? lb->len : 0, dlen, ddata, out->data);
    }
    if (r != 0) {
      if (out) scr_bytes_release(out);
      out = NULL;
      scr_rsa_pubenc_throw("error:0200006E:rsa routines::data too large for key size",
                           "ERR_OSSL_RSA_DATA_TOO_LARGE_FOR_KEY_SIZE");
    }
  } else if (padding == 1) {
    /* PKCS#1 v1.5 (RSAES): an input longer than k - 11 is the too-large
     * failure; the label and the hash do not apply. */
    r = mbedtls_rsa_set_padding(rsa, MBEDTLS_RSA_PKCS_V15, MBEDTLS_MD_NONE);
    if (r == 0) {
      out = scr_bytes_new(SCR_BYTES_U8, (double)k);
      r = mbedtls_rsa_rsaes_pkcs1_v15_encrypt(rsa, mbedtls_ctr_drbg_random, &scr_rsa_pubenc_drbg,
                                              dlen, ddata, out->data);
    }
    if (r != 0) {
      if (out) scr_bytes_release(out);
      out = NULL;
      scr_rsa_pubenc_throw("error:0200006E:rsa routines::data too large for key size",
                           "ERR_OSSL_RSA_DATA_TOO_LARGE_FOR_KEY_SIZE");
    }
  } else {
    /* RSA_NO_PADDING: the raw public operation. The input must be exactly
     * the modulus length (shorter is "too small", longer "too large") and
     * its value must be below the modulus. */
    if (dlen < k) {
      scr_rsa_pubenc_throw("error:0200007A:rsa routines::data too small for key size",
                           "ERR_OSSL_RSA_DATA_TOO_SMALL_FOR_KEY_SIZE");
    } else if (dlen > k) {
      scr_rsa_pubenc_throw("error:0200006E:rsa routines::data too large for key size",
                           "ERR_OSSL_RSA_DATA_TOO_LARGE_FOR_KEY_SIZE");
    } else {
      out = scr_bytes_new(SCR_BYTES_U8, (double)k);
      r = mbedtls_rsa_public(rsa, ddata, out->data);
      if (r != 0) {
        scr_bytes_release(out);
        out = NULL;
        scr_rsa_pubenc_throw("error:02000084:rsa routines::data too large for modulus",
                             "ERR_OSSL_RSA_DATA_TOO_LARGE_FOR_MODULUS");
      }
    }
  }

  mbedtls_pk_free(&pk);
  scr_bytes_release(db);
  if (lb) scr_bytes_release(lb);
  if (out == NULL) return NULL;
  /* Node: publicEncrypt answers a Buffer. */
  return scr_bytes_stamp_buffer(out);
}
