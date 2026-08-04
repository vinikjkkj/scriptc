/* AES-256 (FIPS 197) with GCM, CBC and CTR — see scr_cipher.h for why this
 * is hand-rolled beside the vendored mbedtls.
 *
 * The block cipher is the ordinary four-table construction: the S-box and
 * the four 32-bit T-tables are BUILT AT FIRST USE from the AES field
 * arithmetic rather than pasted in as 9KB of constants, so what is in the
 * source is the definition and not a table nobody can check by reading.
 * The tables are immutable after construction and the build is idempotent,
 * which is what makes the unsynchronized once-flag safe: two racing
 * initializers write identical bytes.
 *
 * Pinned against the NIST vectors (SP 800-38A F.2.5/F.2.6 for CBC,
 * F.5.5/F.5.6 for CTR, SP 800-38D for GCM) in test_cipher.c, and against
 * Node itself through the corpus differential. */
#include "scr_cipher.h"

#include <string.h>

/* ── the field, the S-box and the T-tables ──────────────────────────── */

static unsigned char scr_sbox[256];
static unsigned char scr_rsbox[256];
static uint32_t scr_te[4][256];
static uint32_t scr_td[4][256];
static bool scr_aes_tables_ready = false;

/* Multiplication in GF(2^8) modulo the AES polynomial x^8+x^4+x^3+x+1. */
static unsigned char scr_xtime(unsigned char a) {
  return (unsigned char)((a << 1) ^ ((a >> 7) * 0x1b));
}

static unsigned char scr_gmul(unsigned char a, unsigned char b) {
  unsigned char r = 0;
  while (b) {
    if (b & 1) r = (unsigned char)(r ^ a);
    a = scr_xtime(a);
    b = (unsigned char)(b >> 1);
  }
  return r;
}

static uint32_t scr_rotr32(uint32_t x, unsigned n) {
  return (x >> n) | (x << (32 - n));
}

static void scr_aes_build_tables(void) {
  if (scr_aes_tables_ready) return;
  /* The S-box: the multiplicative inverse in GF(2^8) (0 maps to 0) put
   * through the affine transform. The inverse comes from a log/antilog
   * walk over the generator 3, which is cheaper to read than an extended
   * Euclid and is the standard construction. */
  unsigned char pow_tab[256], log_tab[256];
  unsigned char x = 1;
  for (int i = 0; i < 256; i++) {
    pow_tab[i] = x;
    log_tab[x] = (unsigned char)i;
    x = (unsigned char)(x ^ scr_xtime(x)); /* x *= 3 */
  }
  scr_sbox[0] = 0x63;
  for (int i = 1; i < 256; i++) {
    unsigned char inv = pow_tab[255 - log_tab[i]];
    unsigned char s = inv;
    for (int r = 0; r < 4; r++) {
      s = (unsigned char)((s << 1) | (s >> 7));
      inv = (unsigned char)(inv ^ s);
    }
    scr_sbox[i] = (unsigned char)(inv ^ 0x63);
  }
  for (int i = 0; i < 256; i++) scr_rsbox[scr_sbox[i]] = (unsigned char)i;

  for (int i = 0; i < 256; i++) {
    unsigned char s = scr_sbox[i];
    uint32_t t = ((uint32_t)scr_gmul(s, 2) << 24) | ((uint32_t)s << 16) |
                 ((uint32_t)s << 8) | (uint32_t)scr_gmul(s, 3);
    scr_te[0][i] = t;
    scr_te[1][i] = scr_rotr32(t, 8);
    scr_te[2][i] = scr_rotr32(t, 16);
    scr_te[3][i] = scr_rotr32(t, 24);

    unsigned char r = scr_rsbox[i];
    uint32_t u = ((uint32_t)scr_gmul(r, 14) << 24) | ((uint32_t)scr_gmul(r, 9) << 16) |
                 ((uint32_t)scr_gmul(r, 13) << 8) | (uint32_t)scr_gmul(r, 11);
    scr_td[0][i] = u;
    scr_td[1][i] = scr_rotr32(u, 8);
    scr_td[2][i] = scr_rotr32(u, 16);
    scr_td[3][i] = scr_rotr32(u, 24);
  }
  scr_aes_tables_ready = true;
}

static uint32_t scr_load_be32(const unsigned char *p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}

static void scr_store_be32(unsigned char *p, uint32_t v) {
  p[0] = (unsigned char)(v >> 24);
  p[1] = (unsigned char)(v >> 16);
  p[2] = (unsigned char)(v >> 8);
  p[3] = (unsigned char)v;
}

/* ── key schedule ────────────────────────────────────────────────────── */

void scr_aes256_init(ScrAes256 *st, const unsigned char key[SCR_AES256_KEY]) {
  scr_aes_build_tables();
  const int nk = 8;                          /* 32-byte key = 8 words */
  const int total = 4 * (SCR_AES256_ROUNDS + 1); /* 60 words */
  for (int i = 0; i < nk; i++) st->enc[i] = scr_load_be32(key + 4 * i);
  unsigned char rcon = 1;
  for (int i = nk; i < total; i++) {
    uint32_t t = st->enc[i - 1];
    if (i % nk == 0) {
      t = scr_rotr32(t, 24); /* RotWord */
      t = ((uint32_t)scr_sbox[(t >> 24) & 0xff] << 24) |
          ((uint32_t)scr_sbox[(t >> 16) & 0xff] << 16) |
          ((uint32_t)scr_sbox[(t >> 8) & 0xff] << 8) | (uint32_t)scr_sbox[t & 0xff];
      t ^= (uint32_t)rcon << 24;
      rcon = scr_xtime(rcon);
    } else if (i % nk == 4) {
      /* AES-256 only: an extra SubWord every eighth-plus-four word. */
      t = ((uint32_t)scr_sbox[(t >> 24) & 0xff] << 24) |
          ((uint32_t)scr_sbox[(t >> 16) & 0xff] << 16) |
          ((uint32_t)scr_sbox[(t >> 8) & 0xff] << 8) | (uint32_t)scr_sbox[t & 0xff];
    }
    st->enc[i] = st->enc[i - nk] ^ t;
  }
  /* The equivalent inverse schedule: the same round keys in reverse, with
   * InvMixColumns applied to every one but the first and last. */
  for (int i = 0; i < total; i++) st->dec[i] = st->enc[total - 4 - (i & ~3) + (i & 3)];
  for (int i = 4; i < total - 4; i++) {
    uint32_t w = st->dec[i];
    st->dec[i] = scr_td[0][scr_sbox[(w >> 24) & 0xff]] ^ scr_td[1][scr_sbox[(w >> 16) & 0xff]] ^
                 scr_td[2][scr_sbox[(w >> 8) & 0xff]] ^ scr_td[3][scr_sbox[w & 0xff]];
  }
}

/* ── block encrypt / decrypt ─────────────────────────────────────────── */

void scr_aes256_encrypt_block(const ScrAes256 *st, const unsigned char in[SCR_AES_BLOCK],
                              unsigned char out[SCR_AES_BLOCK]) {
  const uint32_t *rk = st->enc;
  uint32_t s0 = scr_load_be32(in) ^ rk[0];
  uint32_t s1 = scr_load_be32(in + 4) ^ rk[1];
  uint32_t s2 = scr_load_be32(in + 8) ^ rk[2];
  uint32_t s3 = scr_load_be32(in + 12) ^ rk[3];
  uint32_t t0, t1, t2, t3;
  for (int r = 1; r < SCR_AES256_ROUNDS; r++) {
    rk += 4;
    t0 = scr_te[0][(s0 >> 24) & 0xff] ^ scr_te[1][(s1 >> 16) & 0xff] ^
         scr_te[2][(s2 >> 8) & 0xff] ^ scr_te[3][s3 & 0xff] ^ rk[0];
    t1 = scr_te[0][(s1 >> 24) & 0xff] ^ scr_te[1][(s2 >> 16) & 0xff] ^
         scr_te[2][(s3 >> 8) & 0xff] ^ scr_te[3][s0 & 0xff] ^ rk[1];
    t2 = scr_te[0][(s2 >> 24) & 0xff] ^ scr_te[1][(s3 >> 16) & 0xff] ^
         scr_te[2][(s0 >> 8) & 0xff] ^ scr_te[3][s1 & 0xff] ^ rk[2];
    t3 = scr_te[0][(s3 >> 24) & 0xff] ^ scr_te[1][(s0 >> 16) & 0xff] ^
         scr_te[2][(s1 >> 8) & 0xff] ^ scr_te[3][s2 & 0xff] ^ rk[3];
    s0 = t0; s1 = t1; s2 = t2; s3 = t3;
  }
  /* The last round has no MixColumns: take the S-box bytes straight. */
  rk += 4;
  scr_store_be32(out, (((uint32_t)scr_sbox[(s0 >> 24) & 0xff]) << 24 |
                       ((uint32_t)scr_sbox[(s1 >> 16) & 0xff]) << 16 |
                       ((uint32_t)scr_sbox[(s2 >> 8) & 0xff]) << 8 |
                       (uint32_t)scr_sbox[s3 & 0xff]) ^ rk[0]);
  scr_store_be32(out + 4, (((uint32_t)scr_sbox[(s1 >> 24) & 0xff]) << 24 |
                           ((uint32_t)scr_sbox[(s2 >> 16) & 0xff]) << 16 |
                           ((uint32_t)scr_sbox[(s3 >> 8) & 0xff]) << 8 |
                           (uint32_t)scr_sbox[s0 & 0xff]) ^ rk[1]);
  scr_store_be32(out + 8, (((uint32_t)scr_sbox[(s2 >> 24) & 0xff]) << 24 |
                           ((uint32_t)scr_sbox[(s3 >> 16) & 0xff]) << 16 |
                           ((uint32_t)scr_sbox[(s0 >> 8) & 0xff]) << 8 |
                           (uint32_t)scr_sbox[s1 & 0xff]) ^ rk[2]);
  scr_store_be32(out + 12, (((uint32_t)scr_sbox[(s3 >> 24) & 0xff]) << 24 |
                            ((uint32_t)scr_sbox[(s0 >> 16) & 0xff]) << 16 |
                            ((uint32_t)scr_sbox[(s1 >> 8) & 0xff]) << 8 |
                            (uint32_t)scr_sbox[s2 & 0xff]) ^ rk[3]);
}

void scr_aes256_decrypt_block(const ScrAes256 *st, const unsigned char in[SCR_AES_BLOCK],
                              unsigned char out[SCR_AES_BLOCK]) {
  const uint32_t *rk = st->dec;
  uint32_t s0 = scr_load_be32(in) ^ rk[0];
  uint32_t s1 = scr_load_be32(in + 4) ^ rk[1];
  uint32_t s2 = scr_load_be32(in + 8) ^ rk[2];
  uint32_t s3 = scr_load_be32(in + 12) ^ rk[3];
  uint32_t t0, t1, t2, t3;
  for (int r = 1; r < SCR_AES256_ROUNDS; r++) {
    rk += 4;
    /* InvShiftRows walks the other way round the columns. */
    t0 = scr_td[0][(s0 >> 24) & 0xff] ^ scr_td[1][(s3 >> 16) & 0xff] ^
         scr_td[2][(s2 >> 8) & 0xff] ^ scr_td[3][s1 & 0xff] ^ rk[0];
    t1 = scr_td[0][(s1 >> 24) & 0xff] ^ scr_td[1][(s0 >> 16) & 0xff] ^
         scr_td[2][(s3 >> 8) & 0xff] ^ scr_td[3][s2 & 0xff] ^ rk[1];
    t2 = scr_td[0][(s2 >> 24) & 0xff] ^ scr_td[1][(s1 >> 16) & 0xff] ^
         scr_td[2][(s0 >> 8) & 0xff] ^ scr_td[3][s3 & 0xff] ^ rk[2];
    t3 = scr_td[0][(s3 >> 24) & 0xff] ^ scr_td[1][(s2 >> 16) & 0xff] ^
         scr_td[2][(s1 >> 8) & 0xff] ^ scr_td[3][s0 & 0xff] ^ rk[3];
    s0 = t0; s1 = t1; s2 = t2; s3 = t3;
  }
  rk += 4;
  scr_store_be32(out, (((uint32_t)scr_rsbox[(s0 >> 24) & 0xff]) << 24 |
                       ((uint32_t)scr_rsbox[(s3 >> 16) & 0xff]) << 16 |
                       ((uint32_t)scr_rsbox[(s2 >> 8) & 0xff]) << 8 |
                       (uint32_t)scr_rsbox[s1 & 0xff]) ^ rk[0]);
  scr_store_be32(out + 4, (((uint32_t)scr_rsbox[(s1 >> 24) & 0xff]) << 24 |
                           ((uint32_t)scr_rsbox[(s0 >> 16) & 0xff]) << 16 |
                           ((uint32_t)scr_rsbox[(s3 >> 8) & 0xff]) << 8 |
                           (uint32_t)scr_rsbox[s2 & 0xff]) ^ rk[1]);
  scr_store_be32(out + 8, (((uint32_t)scr_rsbox[(s2 >> 24) & 0xff]) << 24 |
                           ((uint32_t)scr_rsbox[(s1 >> 16) & 0xff]) << 16 |
                           ((uint32_t)scr_rsbox[(s0 >> 8) & 0xff]) << 8 |
                           (uint32_t)scr_rsbox[s3 & 0xff]) ^ rk[2]);
  scr_store_be32(out + 12, (((uint32_t)scr_rsbox[(s3 >> 24) & 0xff]) << 24 |
                            ((uint32_t)scr_rsbox[(s2 >> 16) & 0xff]) << 16 |
                            ((uint32_t)scr_rsbox[(s1 >> 8) & 0xff]) << 8 |
                            (uint32_t)scr_rsbox[s0 & 0xff]) ^ rk[3]);
}

/* ── CTR ─────────────────────────────────────────────────────────────── */

static void scr_ctr_inc(unsigned char c[SCR_AES_BLOCK]) {
  for (int i = SCR_AES_BLOCK - 1; i >= 0; i--) {
    if (++c[i] != 0) break;
  }
}

void scr_aes256_ctr(const ScrAes256 *st, unsigned char counter[SCR_AES_BLOCK],
                    const unsigned char *in, size_t len, unsigned char *out) {
  unsigned char ks[SCR_AES_BLOCK];
  size_t i = 0;
  while (i < len) {
    scr_aes256_encrypt_block(st, counter, ks);
    scr_ctr_inc(counter);
    size_t n = len - i < SCR_AES_BLOCK ? len - i : (size_t)SCR_AES_BLOCK;
    for (size_t j = 0; j < n; j++) out[i + j] = (unsigned char)(in[i + j] ^ ks[j]);
    i += n;
  }
}

/* ── CBC ─────────────────────────────────────────────────────────────── */

void scr_aes256_cbc_encrypt(const ScrAes256 *st, unsigned char iv[SCR_AES_BLOCK],
                            const unsigned char *in, size_t len, unsigned char *out) {
  unsigned char blk[SCR_AES_BLOCK];
  for (size_t off = 0; off < len; off += SCR_AES_BLOCK) {
    for (int j = 0; j < SCR_AES_BLOCK; j++) blk[j] = (unsigned char)(in[off + j] ^ iv[j]);
    scr_aes256_encrypt_block(st, blk, out + off);
    memcpy(iv, out + off, SCR_AES_BLOCK);
  }
}

void scr_aes256_cbc_decrypt(const ScrAes256 *st, unsigned char iv[SCR_AES_BLOCK],
                            const unsigned char *in, size_t len, unsigned char *out) {
  unsigned char carry[SCR_AES_BLOCK], blk[SCR_AES_BLOCK];
  for (size_t off = 0; off < len; off += SCR_AES_BLOCK) {
    /* in and out may alias, so the ciphertext block is saved first. */
    memcpy(carry, in + off, SCR_AES_BLOCK);
    scr_aes256_decrypt_block(st, in + off, blk);
    for (int j = 0; j < SCR_AES_BLOCK; j++) out[off + j] = (unsigned char)(blk[j] ^ iv[j]);
    memcpy(iv, carry, SCR_AES_BLOCK);
  }
}

size_t scr_aes256_cbc_encrypt_padded(const ScrAes256 *st, unsigned char iv[SCR_AES_BLOCK],
                                     const unsigned char *in, size_t len, unsigned char *out) {
  const size_t whole = len - (len % SCR_AES_BLOCK);
  scr_aes256_cbc_encrypt(st, iv, in, whole, out);
  /* PKCS#7: the pad is always present, a whole block of 0x10 when the
   * input already ended on a boundary. */
  unsigned char tail[SCR_AES_BLOCK];
  const size_t rem = len - whole;
  const unsigned char pad = (unsigned char)(SCR_AES_BLOCK - rem);
  memcpy(tail, in + whole, rem);
  memset(tail + rem, pad, SCR_AES_BLOCK - rem);
  scr_aes256_cbc_encrypt(st, iv, tail, SCR_AES_BLOCK, out + whole);
  return whole + SCR_AES_BLOCK;
}

long scr_aes256_cbc_decrypt_unpad(const ScrAes256 *st, unsigned char iv[SCR_AES_BLOCK],
                                  const unsigned char *in, size_t len, unsigned char *out) {
  if (len == 0 || len % SCR_AES_BLOCK != 0) return -1;
  scr_aes256_cbc_decrypt(st, iv, in, len, out);
  const unsigned char pad = out[len - 1];
  if (pad == 0 || pad > SCR_AES_BLOCK) return -1;
  for (size_t i = 0; i < pad; i++) {
    if (out[len - 1 - i] != pad) return -1;
  }
  return (long)(len - pad);
}

/* ── GHASH and GCM ───────────────────────────────────────────────────── */

/* Multiplication in GF(2^128) with the GCM bit order: bit 0 of byte 0 is
 * the most significant coefficient, and the reduction polynomial appears
 * as 0xe1 in the top byte. The shift-and-add form is used rather than a
 * precomputed table — the table would be 4KB of state per key for a
 * handshake that hashes a few dozen blocks. */
static void scr_ghash_mul(uint64_t z[2], const uint64_t h[2]) {
  uint64_t zh = 0, zl = 0;
  uint64_t vh = h[0], vl = h[1];
  for (int i = 0; i < 128; i++) {
    const uint64_t bit = (i < 64) ? (z[0] >> (63 - i)) & 1 : (z[1] >> (127 - i)) & 1;
    const uint64_t mask = 0 - bit; /* all ones when the bit is set */
    zh ^= vh & mask;
    zl ^= vl & mask;
    const uint64_t lsb = vl & 1;
    vl = (vl >> 1) | (vh << 63);
    vh >>= 1;
    vh ^= (0 - lsb) & 0xe100000000000000ULL;
  }
  z[0] = zh;
  z[1] = zl;
}

static uint64_t scr_load_be64(const unsigned char *p) {
  uint64_t v = 0;
  for (int i = 0; i < 8; i++) v = (v << 8) | (uint64_t)p[i];
  return v;
}

static void scr_store_be64(unsigned char *p, uint64_t v) {
  for (int i = 0; i < 8; i++) p[i] = (unsigned char)(v >> (56 - 8 * i));
}

/* Absorbs `len` bytes, zero-padded to the block, into the running Y. */
static void scr_ghash_update(uint64_t y[2], const uint64_t h[2], const unsigned char *p,
                             size_t len) {
  unsigned char blk[SCR_AES_BLOCK];
  size_t off = 0;
  while (off < len) {
    const size_t n = len - off < SCR_AES_BLOCK ? len - off : (size_t)SCR_AES_BLOCK;
    memset(blk, 0, SCR_AES_BLOCK);
    memcpy(blk, p + off, n);
    y[0] ^= scr_load_be64(blk);
    y[1] ^= scr_load_be64(blk + 8);
    scr_ghash_mul(y, h);
    off += n;
  }
}

void scr_gcm256_init(ScrGcm *g, const unsigned char key[SCR_AES256_KEY]) {
  scr_aes256_init(&g->aes, key);
  unsigned char zero[SCR_AES_BLOCK] = {0}, hbytes[SCR_AES_BLOCK];
  scr_aes256_encrypt_block(&g->aes, zero, hbytes);
  g->hkey[0] = scr_load_be64(hbytes);
  g->hkey[1] = scr_load_be64(hbytes + 8);
}

/* J0, the pre-counter block. A 12-byte IV is used directly with a
 * trailing 1 (the case SP 800-38D singles out and every caller here
 * uses); any other length is GHASH'd with its bit count. */
static void scr_gcm_j0(const ScrGcm *g, const unsigned char *iv, size_t iv_len,
                       unsigned char j0[SCR_AES_BLOCK]) {
  if (iv_len == 12) {
    memcpy(j0, iv, 12);
    j0[12] = 0; j0[13] = 0; j0[14] = 0; j0[15] = 1;
    return;
  }
  uint64_t y[2] = {0, 0};
  scr_ghash_update(y, g->hkey, iv, iv_len);
  unsigned char lens[SCR_AES_BLOCK];
  memset(lens, 0, 8);
  scr_store_be64(lens + 8, (uint64_t)iv_len * 8);
  y[0] ^= scr_load_be64(lens);
  y[1] ^= scr_load_be64(lens + 8);
  scr_ghash_mul(y, g->hkey);
  scr_store_be64(j0, y[0]);
  scr_store_be64(j0 + 8, y[1]);
}

/* The authentication tag over (aad, ciphertext) with the two bit lengths. */
static void scr_gcm_tag(const ScrGcm *g, const unsigned char j0[SCR_AES_BLOCK],
                        const unsigned char *aad, size_t aad_len,
                        const unsigned char *ct, size_t ct_len, unsigned char tag[SCR_GCM_TAG]) {
  uint64_t y[2] = {0, 0};
  if (aad_len > 0) scr_ghash_update(y, g->hkey, aad, aad_len);
  if (ct_len > 0) scr_ghash_update(y, g->hkey, ct, ct_len);
  unsigned char lens[SCR_AES_BLOCK];
  scr_store_be64(lens, (uint64_t)aad_len * 8);
  scr_store_be64(lens + 8, (uint64_t)ct_len * 8);
  y[0] ^= scr_load_be64(lens);
  y[1] ^= scr_load_be64(lens + 8);
  scr_ghash_mul(y, g->hkey);
  unsigned char s[SCR_AES_BLOCK], ej0[SCR_AES_BLOCK];
  scr_store_be64(s, y[0]);
  scr_store_be64(s + 8, y[1]);
  scr_aes256_encrypt_block(&g->aes, j0, ej0);
  for (int i = 0; i < SCR_GCM_TAG; i++) tag[i] = (unsigned char)(s[i] ^ ej0[i]);
}

void scr_gcm256_encrypt(const ScrGcm *g, const unsigned char *iv, size_t iv_len,
                        const unsigned char *aad, size_t aad_len,
                        const unsigned char *in, size_t len,
                        unsigned char *out, unsigned char tag[SCR_GCM_TAG]) {
  unsigned char j0[SCR_AES_BLOCK], ctr[SCR_AES_BLOCK];
  scr_gcm_j0(g, iv, iv_len, j0);
  memcpy(ctr, j0, SCR_AES_BLOCK);
  scr_ctr_inc(ctr); /* the keystream starts at J0 + 1 */
  if (len > 0) scr_aes256_ctr(&g->aes, ctr, in, len, out);
  scr_gcm_tag(g, j0, aad, aad_len, out, len, tag);
}

bool scr_gcm256_decrypt(const ScrGcm *g, const unsigned char *iv, size_t iv_len,
                        const unsigned char *aad, size_t aad_len,
                        const unsigned char *in, size_t len,
                        const unsigned char *tag, size_t tag_len, unsigned char *out) {
  if (tag_len == 0 || tag_len > SCR_GCM_TAG) return false;
  unsigned char j0[SCR_AES_BLOCK], ctr[SCR_AES_BLOCK], want[SCR_GCM_TAG];
  scr_gcm_j0(g, iv, iv_len, j0);
  /* The tag is over the CIPHERTEXT, so it can be checked BEFORE any
   * plaintext exists. Nothing is written to `out` unless it verifies:
   * unauthenticated bytes must never reach the caller. */
  scr_gcm_tag(g, j0, aad, aad_len, in, len, want);
  unsigned char diff = 0;
  for (size_t i = 0; i < tag_len; i++) diff = (unsigned char)(diff | (want[i] ^ tag[i]));
  if (diff != 0) return false;
  memcpy(ctr, j0, SCR_AES_BLOCK);
  scr_ctr_inc(ctr);
  if (len > 0) scr_aes256_ctr(&g->aes, ctr, in, len, out);
  return true;
}
