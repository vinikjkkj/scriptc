/* AES-256 and the three modes node:crypto's createCipheriv exposes here:
 * GCM, CBC (PKCS#7) and CTR.
 *
 * WHY HAND-ROLLED, with mbedtls vendored two directories away: the
 * vendored archive is LINK-GATED on TLS (backend/cc.ts — `tls` is set by
 * a module that speaks it, or by fetch/net-island), so a program that
 * only encrypts would fail to link against it. The SHA-256/SHA-1/MD5
 * cores in scr_lib.c are hand-rolled beside the same vendored library for
 * the same reason. This unit is gated like scr_asym.c instead: cc.ts
 * links it exactly when a cipher value reaches the IR.
 *
 * The interface below is deliberately FREE of ScrBytes and every other
 * runtime type — it is bytes in, bytes out, so the test binary can
 * compile it alone and the NIST vectors can be checked against nothing
 * else. The value layer that wraps it lives with the Cipher handle.
 *
 * Everything here is CONSTANT-TIME only to the extent the table-driven
 * S-box allows, which is the same stance as the SHA cores: this runtime
 * makes no cache-timing claim, and neither does the reference
 * implementation it follows. */
#ifndef SCR_CIPHER_H
#define SCR_CIPHER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* AES-256 only: 32-byte keys, 14 rounds, a 60-word schedule. The other two
 * key sizes have no caller here — the frontend fences every algorithm name
 * but the three aes-256-* ones. */
#define SCR_AES256_ROUNDS 14
#define SCR_AES_BLOCK 16
#define SCR_AES256_KEY 32
#define SCR_GCM_TAG 16

typedef struct ScrAes256 {
  uint32_t enc[4 * (SCR_AES256_ROUNDS + 1)];
  uint32_t dec[4 * (SCR_AES256_ROUNDS + 1)];
} ScrAes256;

/* Expands a 32-byte key into both schedules. */
void scr_aes256_init(ScrAes256 *st, const unsigned char key[SCR_AES256_KEY]);
void scr_aes256_encrypt_block(const ScrAes256 *st, const unsigned char in[SCR_AES_BLOCK],
                              unsigned char out[SCR_AES_BLOCK]);
void scr_aes256_decrypt_block(const ScrAes256 *st, const unsigned char in[SCR_AES_BLOCK],
                              unsigned char out[SCR_AES_BLOCK]);

/* ── CTR (NIST SP 800-38A) ────────────────────────────────────────────
 * The keystream mode: one call covers any length, encryption and
 * decryption are the same operation. `counter` is the full 16-byte
 * initial counter block and is ADVANCED in place, so a caller may stream
 * across calls. Node's aes-256-ctr increments the whole block as one
 * big-endian integer. */
void scr_aes256_ctr(const ScrAes256 *st, unsigned char counter[SCR_AES_BLOCK],
                    const unsigned char *in, size_t len, unsigned char *out);

/* ── CBC (NIST SP 800-38A) with PKCS#7 (Node's default padding) ───────
 * The encryptor writes `((len / 16) + 1) * 16` bytes — padding is ALWAYS
 * added, a whole extra block when the input is already a multiple.
 * `iv` is advanced to the last ciphertext block so a caller may stream.
 * The decryptor returns the plaintext length, or -1 when the input is not
 * a whole number of blocks, is empty, or carries a malformed pad (Node
 * throws "bad decrypt" for all three). */
size_t scr_aes256_cbc_encrypt_padded(const ScrAes256 *st, unsigned char iv[SCR_AES_BLOCK],
                                     const unsigned char *in, size_t len, unsigned char *out);
long scr_aes256_cbc_decrypt_unpad(const ScrAes256 *st, unsigned char iv[SCR_AES_BLOCK],
                                  const unsigned char *in, size_t len, unsigned char *out);
/* The unpadded halves, for a caller that manages its own block alignment
 * (the streaming Cipher handle buffers a block at a time). `len` must be a
 * multiple of 16. */
void scr_aes256_cbc_encrypt(const ScrAes256 *st, unsigned char iv[SCR_AES_BLOCK],
                            const unsigned char *in, size_t len, unsigned char *out);
void scr_aes256_cbc_decrypt(const ScrAes256 *st, unsigned char iv[SCR_AES_BLOCK],
                            const unsigned char *in, size_t len, unsigned char *out);

/* ── GCM (NIST SP 800-38D) ───────────────────────────────────────────
 * One-shot over a whole message. The IV is any length Node accepts (12
 * bytes takes the fast path the spec singles out; anything else is
 * GHASH-derived). `aad` may be NULL with `aad_len` 0.
 *
 * The decryptor VERIFIES in constant time and returns false on a tag
 * mismatch WITHOUT writing plaintext the caller could mistake for
 * authentic — Node throws "Unsupported state or unable to authenticate
 * data" there, and the whole point of the mode is that the caller never
 * sees unauthenticated bytes. */
typedef struct ScrGcm {
  ScrAes256 aes;
  uint64_t hkey[2]; /* H = E(K, 0^128), as two big-endian halves */
} ScrGcm;

void scr_gcm256_init(ScrGcm *g, const unsigned char key[SCR_AES256_KEY]);

/* The STREAMING form, for a Cipher handle whose update() must return the
 * same bytes at the same call Node's does. GHASH absorbs whole blocks
 * only, so the context buffers up to 15 bytes between calls; the
 * keystream needs no buffering beyond its counter because CTR is a stream
 * cipher. Order is fixed and matches Node: aad() before the first
 * update(), then update() any number of times, then finish(). */
typedef struct ScrGcmCtx {
  ScrGcm g;
  unsigned char j0[SCR_AES_BLOCK];
  unsigned char ctr[SCR_AES_BLOCK];
  uint64_t y[2];                  /* running GHASH */
  unsigned char buf[SCR_AES_BLOCK]; /* partial GHASH block */
  size_t buflen;
  uint64_t aad_len, ct_len;
  unsigned char ks[SCR_AES_BLOCK]; /* keystream remainder */
  size_t ksleft;
  bool in_data; /* aad is closed once the first update lands */
} ScrGcmCtx;

void scr_gcm256_start(ScrGcmCtx *c, const unsigned char key[SCR_AES256_KEY],
                      const unsigned char *iv, size_t iv_len);
void scr_gcm256_aad(ScrGcmCtx *c, const unsigned char *p, size_t n);
/* Encrypts (or decrypts) n bytes and hashes the CIPHERTEXT side, whichever
 * that is. Writes exactly n bytes to out — the caller sees them at the
 * same call Node does. */
void scr_gcm256_stream(ScrGcmCtx *c, bool decrypt, const unsigned char *in, size_t n,
                       unsigned char *out);
void scr_gcm256_finish(ScrGcmCtx *c, unsigned char tag[SCR_GCM_TAG]);
void scr_gcm256_encrypt(const ScrGcm *g, const unsigned char *iv, size_t iv_len,
                        const unsigned char *aad, size_t aad_len,
                        const unsigned char *in, size_t len,
                        unsigned char *out, unsigned char tag[SCR_GCM_TAG]);
bool scr_gcm256_decrypt(const ScrGcm *g, const unsigned char *iv, size_t iv_len,
                        const unsigned char *aad, size_t aad_len,
                        const unsigned char *in, size_t len,
                        const unsigned char *tag, size_t tag_len, unsigned char *out);

#endif /* SCR_CIPHER_H */
