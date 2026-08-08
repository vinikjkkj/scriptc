/* createCipheriv/createDecipheriv keyed by a KeyObject — the ONE call that
 * touches both optional crypto halves.
 *
 * It reads an ScrKeyObject (scr_asym.c, the `asym` gate) and builds an
 * ScrCipher through scr_cipher_new_raw (scr_cipher_value.c, the `cipher`
 * gate). It used to sit in scr_asym.c beside scr_hmac_new_key, which made
 * every keyobj-only program carry an undefined reference to
 * scr_cipher_new_raw into the link — `lld-link: undefined symbol` at the
 * very end of a build, with no hint of which gate was missing.
 *
 * A bridge between two optional units belongs in a TU gated on BOTH, which
 * is the shape cc.ts already uses for scr_inspect_island.c (island ∧
 * inspect) and scr_zlib_island.c (island ∧ zlib). The emitted call can
 * only exist when both gates are on anyway: the argument is a keyobj value
 * (asym) and the result is a cipher value (cipher), so neither half pays
 * for this file on its own. */
#include "scr_runtime.h"

#include <string.h>

ScrCipher *scr_cipher_new_key(ScrStr *alg, ScrKeyObject *key, ScrBytes *iv, bool decrypt) {
  if (!scr_keyobj_is_secret(key)) {
    /* Node's ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE, a TypeError — the same
     * refusal scr_hmac_new_key gives for an asymmetric key. */
    static const char msg[] = "Invalid key object type private, expected secret";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof(msg) - 1);
    return NULL;
  }
  size_t len = 0;
  const unsigned char *secret = scr_keyobj_secret(key, &len);
  return scr_cipher_new_raw(alg, secret, len, iv->data, iv->len * scr_bytes_elem_size(iv->elem),
                            decrypt);
}
