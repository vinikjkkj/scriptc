/* Asymmetric keys: X25519 key agreement and Ed25519 signatures, the pair
 * Node exposes through generateKeyPair/diffieHellman/sign/verify and the
 * KeyObject value that carries them. Compiled only when the program reaches
 * one of those surfaces (cc.ts gates it like scr_regex.c/scr_zlib.c).
 *
 * The primitives come from the vendored Monocypher (see
 * vendor/README.md) — audited, radix-2^51 field arithmetic, no allocations,
 * no secret-dependent branches. This file is only the adapter: scriptc value
 * shapes in, raw 32/64-byte buffers out.
 *
 * Ed25519 here is the SHA-512 flavour (RFC 8032), from Monocypher's optional
 * unit. Monocypher's DEFAULT EdDSA is BLAKE2b-based and would produce
 * signatures Node rejects — the two must never be mixed up. */
#include "scr_runtime.h"

#include <stdlib.h>
#include <string.h>

#include "monocypher.h"
#include "monocypher-ed25519.h"

/* ── KeyObject ────────────────────────────────────────────────────────── */

/* Node's TypeError, raised from the refusals below (defined with the DER
 * framing further down, forward-declared here because the secret-key
 * constructor above it needs the same refusal). */
static void scr_asym_throw(const char *msg);

/* Node's KeyObject for these curves carries exactly one 32-byte scalar (a
 * private seed) or one 32-byte point (a public key), plus which of the two it
 * is and which curve. Everything else Node keeps in one — PEM/DER framing,
 * OIDs — is derived on demand at the export surfaces. */
ScrKeyObject *scr_keyobj_new(int curve, bool is_private, const unsigned char raw[32]) {
  ScrKeyObject *k = malloc(sizeof(ScrKeyObject));
  if (!k) scr_trap("scriptc: out of memory\n");
  scr_keyobj_alloc_note();
  k->rc = 1;
  k->curve = curve;
  k->is_private = is_private;
  memcpy(k->raw, raw, 32);
  k->secret = NULL;
  k->secret_len = 0;
  return k;
}

ScrKeyObject *scr_keyobj_retain(ScrKeyObject *k) {
  if (k && k->rc != SIZE_MAX) k->rc++;
  return k;
}

void scr_keyobj_release(ScrKeyObject *k) {
  if (!k || k->rc == SIZE_MAX) return;
  if (--k->rc == 0) {
    crypto_wipe(k->raw, 32);
    if (k->secret) {
      crypto_wipe(k->secret, k->secret_len);
      free(k->secret);
    }
    scr_keyobj_free_note();
    free(k);
  }
}

/* ── createSecretKey: the SYMMETRIC KeyObject ──────────────────────────
 * A copy of the material, wiped on the last release like the asymmetric
 * secret beside it. EVERY length is legal, including zero — Node accepts a
 * zero-length secret key (checked against the oracle; an earlier draft
 * here raised a RangeError for it and the differential caught the
 * invention). HMAC takes any length; the AES ciphers check their own at
 * construction. */
static ScrKeyObject *scr_keyobj_secret_new(const unsigned char *key, size_t len) {
  ScrKeyObject *k = malloc(sizeof(ScrKeyObject));
  if (!k) scr_trap("scriptc: out of memory\n");
  scr_keyobj_alloc_note();
  k->rc = 1;
  k->curve = SCR_KEY_SECRET;
  k->is_private = true; /* Node reports type 'secret'; never a public half. */
  memset(k->raw, 0, 32);
  k->secret = NULL;
  if (len > 0) {
    k->secret = malloc(len);
    if (!k->secret) scr_trap("scriptc: out of memory\n");
    memcpy(k->secret, key, len);
  }
  k->secret_len = len;
  return k;
}

ScrKeyObject *scr_key_secret_bytes(const ScrBytes *key) {
  return scr_keyobj_secret_new(key->data, key->len * scr_bytes_elem_size(key->elem));
}

ScrKeyObject *scr_key_secret_str(const ScrStr *key) {
  /* Node's default encoding for a string key is utf8, and ScrStr storage
   * IS utf8 — the bytes are the string's own. */
  return scr_keyobj_secret_new((const unsigned char *)key->data, key->len);
}

/* Which half a KeyObject is. The POINTER cannot answer this: a
 * zero-length secret key is legal and its `secret` is NULL too. */
bool scr_keyobj_is_secret(const ScrKeyObject *k) {
  return k->curve == SCR_KEY_SECRET;
}

const unsigned char *scr_keyobj_secret(const ScrKeyObject *k, size_t *len) {
  *len = k->curve == SCR_KEY_SECRET ? k->secret_len : 0;
  return k->curve == SCR_KEY_SECRET ? k->secret : NULL;
}

double scr_key_secret_size(const ScrKeyObject *k) {
  return k->curve == SCR_KEY_SECRET ? (double)k->secret_len : 0.0;
}

/* createHmac keyed by a KeyObject. It lives HERE, not beside the other
 * Hmac calls in scr_lib.c: it reads ScrKeyObject, and scr_asym.c is the
 * unit cc.ts links exactly when a keyobj value reaches the IR — which is
 * exactly when this call can be emitted. scr_hmac_new_raw comes the other
 * way, out of the always-linked scr_lib.c. Only a SECRET key carries
 * material; an asymmetric one gets Node's TypeError.
 *
 * Its createCipheriv twin does NOT live here: scr_cipher_new_raw comes out
 * of scr_cipher_value.c, which rides the CIPHER gate, and this unit rides
 * the ASYM one — a keyobj-only program would have carried an undefined
 * reference into the link. The bridge is its own two-gate TU
 * (scr_cipher_key.c), the scr_inspect_island.c / scr_zlib_island.c
 * pattern. */
ScrHmac *scr_hmac_new_key(ScrStr *alg, ScrKeyObject *key) {
  if (!scr_keyobj_is_secret(key)) {
    scr_asym_throw("Invalid key object type private, expected secret");
    return NULL;
  }
  size_t len = 0;
  const unsigned char *secret = scr_keyobj_secret(key, &len);
  return scr_hmac_new_raw(alg, secret, len);
}

/* ── DER framing ──────────────────────────────────────────────────────── */

/* The PKCS#8 and SPKI wrappers for these two curves are FIXED-LENGTH: a
 * 16-byte prefix over a 32-byte private seed, a 12-byte prefix over a 32-byte
 * public point. Callers (Node's own createPrivateKey/createPublicKey) accept
 * only these shapes for X25519/Ed25519, so the parse is a prefix check and a
 * tail copy rather than a general DER reader — and a general reader here
 * would be a liability, not a feature. */
static const unsigned char pkcs8_x25519[16] = { 0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
                                                0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20 };
static const unsigned char pkcs8_ed25519[16] = { 0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
                                                 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20 };
static const unsigned char spki_x25519[12] = { 0x30, 0x2a, 0x30, 0x05, 0x06, 0x03,
                                               0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00 };
static const unsigned char spki_ed25519[12] = { 0x30, 0x2a, 0x30, 0x05, 0x06, 0x03,
                                                0x2b, 0x65, 0x70, 0x03, 0x21, 0x00 };

static void scr_asym_throw(const char *msg) {
  scr_throw_error_msg(SCR_ERR_TYPE, msg, strlen(msg));
}

ScrKeyObject *scr_keyobj_from_pkcs8(const unsigned char *der, size_t len) {
  if (len == 48 && memcmp(der, pkcs8_ed25519, 16) == 0) {
    return scr_keyobj_new(SCR_CURVE_ED25519, true, der + 16);
  }
  if (len == 48 && memcmp(der, pkcs8_x25519, 16) == 0) {
    return scr_keyobj_new(SCR_CURVE_X25519, true, der + 16);
  }
  scr_asym_throw("Invalid PKCS#8 key: only X25519 and Ed25519 private keys are supported");
  return NULL;
}

ScrKeyObject *scr_keyobj_from_spki(const unsigned char *der, size_t len) {
  if (len == 44 && memcmp(der, spki_ed25519, 12) == 0) {
    return scr_keyobj_new(SCR_CURVE_ED25519, false, der + 12);
  }
  if (len == 44 && memcmp(der, spki_x25519, 12) == 0) {
    return scr_keyobj_new(SCR_CURVE_X25519, false, der + 12);
  }
  scr_asym_throw("Invalid SPKI key: only X25519 and Ed25519 public keys are supported");
  return NULL;
}

/* ── the operations ───────────────────────────────────────────────────── */

void scr_asym_keypair(int curve, unsigned char priv[32], unsigned char pub[32]) {
  arc4random_buf(priv, 32);
  if (curve == SCR_CURVE_ED25519) {
    unsigned char sk[64];
    crypto_ed25519_key_pair(sk, pub, priv);
    /* crypto_ed25519_key_pair WIPES the seed it was handed and returns the
     * 64-byte expanded form; Node's jwk `d` is the 32-byte SEED, which is
     * that form's first half. */
    memcpy(priv, sk, 32);
    crypto_wipe(sk, 64);
    return;
  }
  crypto_x25519_public_key(pub, priv);
}

/* The X25519 shared secret. An all-zero result means the peer sent a
 * low-order point — Node throws for that, so the caller gets false and
 * raises. */
bool scr_asym_dh(unsigned char out[32], const ScrKeyObject *priv, const ScrKeyObject *pub) {
  if (priv->curve != SCR_CURVE_X25519 || pub->curve != SCR_CURVE_X25519) {
    scr_asym_throw("diffieHellman requires two X25519 keys");
    return false;
  }
  if (!priv->is_private || pub->is_private) {
    scr_asym_throw("diffieHellman needs a private key and a public key");
    return false;
  }
  crypto_x25519(out, priv->raw, pub->raw);
  unsigned char acc = 0;
  for (int i = 0; i < 32; i++) acc |= out[i];
  return acc != 0;
}

void scr_asym_sign(unsigned char sig[64], const ScrKeyObject *key, const unsigned char *msg,
                   size_t n) {
  if (key->curve != SCR_CURVE_ED25519 || !key->is_private) {
    scr_asym_throw("sign requires an Ed25519 private key");
    return;
  }
  /* Monocypher signs with the EXPANDED 64-byte secret (scalar || public
   * point); the KeyObject holds the 32-byte SEED, which is what Node's jwk
   * `d` carries. Expanding here keeps the stored form the interoperable one.
   * crypto_ed25519_key_pair wipes the seed buffer it is handed, so it gets a
   * copy, never key->raw. */
  unsigned char seed[32], sk[64], pk[32];
  memcpy(seed, key->raw, 32);
  crypto_ed25519_key_pair(sk, pk, seed);
  crypto_ed25519_sign(sig, sk, msg, n);
  crypto_wipe(sk, 64);
  crypto_wipe(seed, 32);
}

bool scr_asym_verify(const unsigned char sig[64], const ScrKeyObject *key,
                     const unsigned char *msg, size_t n) {
  if (key->curve != SCR_CURVE_ED25519 || key->is_private) {
    scr_asym_throw("verify requires an Ed25519 public key");
    return false;
  }
  return crypto_ed25519_check(sig, key->raw, msg, n) == 0;
}

/* The public point for a private KeyObject — what `export({format:'jwk'}).x`
 * answers, and what createPublicKey(privateKeyObject) derives. */
void scr_asym_public_of(unsigned char pub[32], const ScrKeyObject *key) {
  /* dh/sign/verify already refuse a secret key by curve; these two read
   * `raw` unconditionally, so they need the refusal spelled out. Node
   * raises ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE for the same call. */
  if (key->curve == SCR_KEY_SECRET) {
    scr_asym_throw("Invalid key object type secret, expected private or public");
    return;
  }
  if (!key->is_private) {
    memcpy(pub, key->raw, 32);
    return;
  }
  if (key->curve == SCR_CURVE_ED25519) {
    unsigned char seed[32], sk[64];
    memcpy(seed, key->raw, 32);
    crypto_ed25519_key_pair(sk, pub, seed);
    crypto_wipe(sk, 64);
    crypto_wipe(seed, 32);
    return;
  }
  crypto_x25519_public_key(pub, key->raw);
}

void scr_asym_raw_of(unsigned char raw[32], const ScrKeyObject *key) {
  if (key->curve == SCR_KEY_SECRET) {
    scr_asym_throw("Invalid key object type secret, expected private or public");
    return;
  }
  memcpy(raw, key->raw, 32);
}

int scr_asym_curve_of(const ScrKeyObject *key) {
  return key->curve;
}

bool scr_asym_is_private(const ScrKeyObject *key) {
  return key->is_private;
}

/* The void* adapters ScrArr/ScrMap element tables call through. */
void *scr_keyobj_retain_v(void *k) { return scr_keyobj_retain((ScrKeyObject *)k); }
void scr_keyobj_release_v(void *k) { scr_keyobj_release((ScrKeyObject *)k); }

/* ------------------------------------------------------------------ */
/* The scriptc-value layer: ScrBytes in, ScrBytes/ScrKeyObject out. All
 * arguments BORROWED, every result +1 (the libCall convention). */

ScrKeyObject *scr_key_from_pkcs8(const ScrBytes *der) {
  return scr_keyobj_from_pkcs8(der->data, der->len);
}

ScrKeyObject *scr_key_from_spki(const ScrBytes *der) {
  return scr_keyobj_from_spki(der->data, der->len);
}

/* Every raw answer in this file is one of Node's Buffers
 * (diffieHellman, sign, the raw key exports) — the flavor is stamped at
 * the ONE allocation they share, error returns included below. */
static ScrBytes *scr_asym_bytes(const unsigned char *src, size_t n) {
  ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, (double)n);
  memcpy(b->data, src, n);
  return scr_bytes_stamp_buffer(b);
}

ScrBytes *scr_key_dh(const ScrKeyObject *priv, const ScrKeyObject *pub) {
  unsigned char out[32];
  if (!scr_asym_dh(out, priv, pub)) {
    if (!scr_exc_pending()) {
      const char *m = "Unable to compute the shared secret";
      scr_throw_error_msg(SCR_ERR_TYPE, m, strlen(m));
    }
    return scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, 0));
  }
  return scr_asym_bytes(out, 32);
}

ScrBytes *scr_key_sign(const ScrBytes *msg, const ScrKeyObject *key) {
  unsigned char sig[64];
  scr_asym_sign(sig, key, msg->data, msg->len);
  if (scr_exc_pending()) return scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, 0));
  return scr_asym_bytes(sig, 64);
}

bool scr_key_verify(const ScrBytes *msg, const ScrKeyObject *key, const ScrBytes *sig) {
  if (sig->len != 64) return false;
  return scr_asym_verify(sig->data, key, msg->data, msg->len);
}

ScrBytes *scr_key_pub_raw(const ScrKeyObject *key) {
  unsigned char pub[32];
  scr_asym_public_of(pub, key);
  return scr_asym_bytes(pub, 32);
}

ScrBytes *scr_key_raw(const ScrKeyObject *key) {
  unsigned char raw[32];
  scr_asym_raw_of(raw, key);
  return scr_asym_bytes(raw, 32);
}

/* generateKeyPair's two halves come from one draw: the caller asks for the
 * private side first and the public side second, both off the same fresh
 * scalar, so the pair is generated ONCE and cached.
 *
 * The invariant this rests on: the two calls are the two FIELDS of a single
 * record literal, emitted back to back with no suspension point between them
 * (an await can only appear at a statement boundary, and neither call awaits).
 * Nothing else can draw a pair in between, so the public half always belongs
 * to the private half beside it. A lowering that ever split them across a
 * possible suspension would have to thread the private key through instead. */
static int scr_key_gen_curve = -1;
static unsigned char scr_key_gen_priv[32];
static unsigned char scr_key_gen_pub[32];

ScrKeyObject *scr_key_gen(double curve, bool want_private) {
  int c = (int)curve;
  if (want_private || scr_key_gen_curve != c) {
    scr_asym_keypair(c, scr_key_gen_priv, scr_key_gen_pub);
    scr_key_gen_curve = c;
  }
  return scr_keyobj_new(c, want_private,
                        want_private ? scr_key_gen_priv : scr_key_gen_pub);
}

/* The JWK halves. Node renders both as base64url WITHOUT padding, which is
 * exactly what scr_bytes_to_str's "base64url" produces. `d` is the 32-byte
 * seed and only exists on a private key; the caller picks between this and
 * undefined with scr_key_is_priv. */
ScrStr *scr_key_jwk_x(const ScrKeyObject *key) {
  unsigned char pub[32];
  scr_asym_public_of(pub, key);
  ScrBytes *b = scr_asym_bytes(pub, 32);
  ScrStr *enc = scr_str_new("base64url", 9);
  ScrStr *s = scr_bytes_to_str(b, enc);
  scr_str_release(enc);
  scr_bytes_release(b);
  return s;
}

ScrStr *scr_key_jwk_d(const ScrKeyObject *key) {
  if (key->curve == SCR_KEY_SECRET) {
    scr_asym_throw("Invalid key object type secret, expected private or public");
    return NULL;
  }
  ScrBytes *b = scr_asym_bytes(key->raw, 32);
  ScrStr *enc = scr_str_new("base64url", 9);
  ScrStr *s = scr_bytes_to_str(b, enc);
  scr_str_release(enc);
  scr_bytes_release(b);
  return s;
}

bool scr_key_is_priv(const ScrKeyObject *key) { return key->is_private; }

ScrStr *scr_key_crv(const ScrKeyObject *key) {
  if (key->curve == SCR_KEY_SECRET) {
    /* A secret key has no curve; Node's jwk export answers kty 'oct'. The
     * jwk surface refuses it above, so reaching here would be a bug. */
    scr_asym_throw("Invalid key object type secret, expected private or public");
    return NULL;
  }
  return key->curve == SCR_CURVE_ED25519 ? scr_str_new("Ed25519", 7) : scr_str_new("X25519", 6);
}

/* The promisified twins. All three are synchronous work behind an
 * already-settled promise — the crypto is microseconds and the callback
 * forms Node exposes only exist to keep it off the event loop, which a
 * compiled program has no thread pool to use anyway. */
ScrPromise *scr_key_sign_async(const ScrBytes *msg, const ScrKeyObject *key) {
  ScrBytes *sig = scr_key_sign(msg, key);
  return scr_promise_settled_ref(sig, &scr_bytes_retain_v, &scr_bytes_release_v, NULL);
}

ScrPromise *scr_key_verify_async(const ScrBytes *msg, const ScrKeyObject *key,
                                 const ScrBytes *sig) {
  return scr_promise_settled_bool(scr_key_verify(msg, key, sig));
}

ScrPromise *scr_key_gen_async(double curve, bool want_private) {
  ScrKeyObject *k = scr_key_gen(curve, want_private);
  return scr_promise_settled_ref(k, &scr_keyobj_retain_v, &scr_keyobj_release_v, NULL);
}
