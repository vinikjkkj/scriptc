/* AES-256 against the PUBLISHED vectors. Nothing here calls into the rest
 * of the runtime — scr_cipher.c is deliberately free of ScrBytes so this
 * binary can compile the primitive alone, and a failure can only mean the
 * primitive is wrong.
 *
 *   FIPS 197 C.3           — the single-block AES-256 vector
 *   SP 800-38A F.2.5/F.2.6 — CBC-AES256 encrypt/decrypt, four blocks
 *   SP 800-38A F.5.5/F.5.6 — CTR-AES256 encrypt/decrypt, four blocks
 *   SP 800-38D             — GCM-AES256 test cases 13-16
 *
 * plus the properties the vectors do not reach: PKCS#7 padding at and
 * around a block boundary, a rejected pad, GCM tag rejection, and the
 * aliasing the streaming layer will do (in == out). */
#include "scr_cipher.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

static void hexdump(const unsigned char *p, size_t n, char *out) {
  static const char hex[] = "0123456789abcdef";
  for (size_t i = 0; i < n; i++) {
    out[i * 2] = hex[p[i] >> 4];
    out[i * 2 + 1] = hex[p[i] & 15];
  }
  out[n * 2] = 0;
}

static void check(const char *what, const unsigned char *got, const unsigned char *want,
                  size_t n) {
  if (memcmp(got, want, n) == 0) return;
  char g[1024], w[1024];
  hexdump(got, n < 500 ? n : 500, g);
  hexdump(want, n < 500 ? n : 500, w);
  printf("FAIL %s\n  got  %s\n  want %s\n", what, g, w);
  failures++;
}

static void check_true(const char *what, int cond) {
  if (cond) return;
  printf("FAIL %s\n", what);
  failures++;
}

/* Parses an even-length hex string into buf; returns the byte count. */
static size_t unhex(const char *s, unsigned char *buf) {
  size_t n = 0;
  for (; s[0] && s[1]; s += 2) {
    unsigned v;
    sscanf(s, "%2x", &v);
    buf[n++] = (unsigned char)v;
  }
  return n;
}

/* ── FIPS 197 C.3: one block, AES-256 ────────────────────────────────── */
static void test_block(void) {
  unsigned char key[32], in[16], want[16], got[16], back[16];
  unhex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", key);
  unhex("00112233445566778899aabbccddeeff", in);
  unhex("8ea2b7ca516745bfeafc49904b496089", want);
  ScrAes256 st;
  scr_aes256_init(&st, key);
  scr_aes256_encrypt_block(&st, in, got);
  check("FIPS197 C.3 encrypt", got, want, 16);
  scr_aes256_decrypt_block(&st, want, back);
  check("FIPS197 C.3 decrypt", back, in, 16);
}

/* The SP 800-38A key and plaintext, shared by the CBC and CTR vectors. */
static const char *K38A = "603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4";
static const char *P38A =
    "6bc1bee22e409f96e93d7e117393172a"
    "ae2d8a571e03ac9c9eb76fac45af8e51"
    "30c81c46a35ce411e5fbc1191a0a52ef"
    "f69f2445df4f9b17ad2b417be66c3710";

/* ── SP 800-38A F.2.5 / F.2.6: CBC-AES256 ────────────────────────────── */
static void test_cbc_vectors(void) {
  unsigned char key[32], iv[16], ivw[16], pt[64], want[64], got[64], back[64];
  unhex(K38A, key);
  unhex("000102030405060708090a0b0c0d0e0f", iv);
  unhex(P38A, pt);
  unhex("f58c4c04d6e5f1ba779eabfb5f7bfbd6"
        "9cfc4e967edb808d679f777bc6702c7d"
        "39f23369a9d9bacfa530e26304231461"
        "b2eb05e2c39be9fcda6c19078c6a9d1b",
        want);
  ScrAes256 st;
  scr_aes256_init(&st, key);
  memcpy(ivw, iv, 16);
  scr_aes256_cbc_encrypt(&st, ivw, pt, 64, got);
  check("SP800-38A F.2.5 CBC-AES256 encrypt", got, want, 64);
  memcpy(ivw, iv, 16);
  scr_aes256_cbc_decrypt(&st, ivw, want, 64, back);
  check("SP800-38A F.2.6 CBC-AES256 decrypt", back, pt, 64);

  /* The streaming layer decrypts in place; in == out must still work. */
  unsigned char alias[64];
  memcpy(alias, want, 64);
  memcpy(ivw, iv, 16);
  scr_aes256_cbc_decrypt(&st, ivw, alias, 64, alias);
  check("CBC decrypt in place (in == out)", alias, pt, 64);
}

/* ── SP 800-38A F.5.5 / F.5.6: CTR-AES256 ────────────────────────────── */
static void test_ctr_vectors(void) {
  unsigned char key[32], ctr[16], ctrw[16], pt[64], want[64], got[64], back[64];
  unhex(K38A, key);
  unhex("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff", ctr);
  unhex(P38A, pt);
  unhex("601ec313775789a5b7a7f504bbf3d228"
        "f443e3ca4d62b59aca84e990cacaf5c5"
        "2b0930daa23de94ce87017ba2d84988d"
        "dfc9c58db67aada613c2dd08457941a6",
        want);
  ScrAes256 st;
  scr_aes256_init(&st, key);
  memcpy(ctrw, ctr, 16);
  scr_aes256_ctr(&st, ctrw, pt, 64, got);
  check("SP800-38A F.5.5 CTR-AES256 encrypt", got, want, 64);
  memcpy(ctrw, ctr, 16);
  scr_aes256_ctr(&st, ctrw, want, 64, back);
  check("SP800-38A F.5.6 CTR-AES256 decrypt", back, pt, 64);

  /* Streaming: the counter is advanced in place, so encrypting in three
   * unaligned pieces must equal encrypting in one. */
  unsigned char piece[64];
  memcpy(ctrw, ctr, 16);
  scr_aes256_ctr(&st, ctrw, pt, 16, piece);
  scr_aes256_ctr(&st, ctrw, pt + 16, 16, piece + 16);
  scr_aes256_ctr(&st, ctrw, pt + 32, 32, piece + 32);
  check("CTR across three calls equals one", piece, want, 64);

  /* The counter carries all the way: 0xff..ff increments to 0x00..00,
   * every byte, with nothing left over. */
  unsigned char wrap[16], one[16];
  memset(wrap, 0xff, 16);
  const unsigned char zero16[16] = {0};
  scr_aes256_ctr(&st, wrap, zero16, 1, one);
  int all_zero = 1;
  for (int i = 0; i < 16; i++) all_zero &= wrap[i] == 0;
  check_true("CTR counter wrapped to zero across every byte", all_zero);
  /* And a carry that stops in the middle: ..00ff -> ..0100. */
  memset(wrap, 0, 16);
  wrap[14] = 0x00;
  wrap[15] = 0xff;
  scr_aes256_ctr(&st, wrap, zero16, 1, one);
  check_true("CTR carry stops where it should", wrap[14] == 1 && wrap[15] == 0);
}

/* ── PKCS#7, the property the SP vectors do not reach ────────────────── */
static void test_cbc_padding(void) {
  unsigned char key[32], iv[16], ivw[16], out[80], back[80];
  unhex(K38A, key);
  unhex("000102030405060708090a0b0c0d0e0f", iv);
  ScrAes256 st;
  scr_aes256_init(&st, key);

  /* Node's default padding always appends: 16 bytes in gives 32 out. */
  for (size_t len = 0; len <= 33; len++) {
    unsigned char pt[33];
    for (size_t i = 0; i < len; i++) pt[i] = (unsigned char)(i * 7 + 1);
    memcpy(ivw, iv, 16);
    const size_t n = scr_aes256_cbc_encrypt_padded(&st, ivw, pt, len, out);
    check_true("padded length is the next whole block, always growing",
               n == ((len / 16) + 1) * 16);
    memcpy(ivw, iv, 16);
    const long got = scr_aes256_cbc_decrypt_unpad(&st, ivw, out, n, back);
    check_true("unpad recovers the length", got == (long)len);
    if (got == (long)len) check("unpad recovers the bytes", back, pt, len);
  }

  /* A corrupted final block is rejected rather than returning garbage.
   * (Flipping a ciphertext bit changes the decrypted pad byte; only a
   * 1-in-256 pad would survive by luck, and this one does not.) */
  memcpy(ivw, iv, 16);
  const size_t n = scr_aes256_cbc_encrypt_padded(&st, ivw, (const unsigned char *)"abc", 3, out);
  out[n - 1] ^= 0x01;
  memcpy(ivw, iv, 16);
  check_true("a corrupt pad is refused", scr_aes256_cbc_decrypt_unpad(&st, ivw, out, n, back) < 0);
  /* Empty input and a partial block are refused too (Node: bad decrypt). */
  memcpy(ivw, iv, 16);
  check_true("empty ciphertext is refused", scr_aes256_cbc_decrypt_unpad(&st, ivw, out, 0, back) < 0);
  memcpy(ivw, iv, 16);
  check_true("a partial block is refused", scr_aes256_cbc_decrypt_unpad(&st, ivw, out, 17, back) < 0);
}

/* ── SP 800-38D: GCM-AES256, the published test cases 13-16 ──────────── */
struct GcmCase {
  const char *name, *key, *iv, *aad, *pt, *ct, *tag;
};

static void run_gcm(const struct GcmCase *c) {
  unsigned char key[32], iv[64], aad[64], pt[64], ct[64], tag[16];
  unsigned char gotct[64], gottag[16], back[64];
  unhex(c->key, key);
  const size_t iv_len = unhex(c->iv, iv);
  const size_t aad_len = unhex(c->aad, aad);
  const size_t pt_len = unhex(c->pt, pt);
  unhex(c->ct, ct);
  unhex(c->tag, tag);

  ScrGcm g;
  scr_gcm256_init(&g, key);
  scr_gcm256_encrypt(&g, iv, iv_len, aad_len ? aad : NULL, aad_len, pt, pt_len, gotct, gottag);
  if (pt_len) check(c->name, gotct, ct, pt_len);
  check(c->name, gottag, tag, 16);

  check_true("gcm decrypt verifies",
             scr_gcm256_decrypt(&g, iv, iv_len, aad_len ? aad : NULL, aad_len, ct, pt_len, tag,
                                16, back));
  if (pt_len) check("gcm decrypt plaintext", back, pt, pt_len);

  /* A flipped tag bit must be refused, and must leave `back` untouched —
   * unauthenticated plaintext may never reach the caller. */
  unsigned char bad[16];
  memcpy(bad, tag, 16);
  bad[0] ^= 0x80;
  memset(back, 0xAA, sizeof back);
  check_true("gcm refuses a wrong tag",
             !scr_gcm256_decrypt(&g, iv, iv_len, aad_len ? aad : NULL, aad_len, ct, pt_len, bad,
                                 16, back));
  for (size_t i = 0; i < pt_len; i++) {
    check_true("gcm wrote no plaintext on failure", back[i] == 0xAA);
  }
}

static void test_gcm_vectors(void) {
  /* SP 800-38D / the GCM specification's AES-256 cases. 13 and 14 are the
   * empty and single-block cases; 15 and 16 carry AAD. */
  static const struct GcmCase cases[] = {
      {"GCM case 13 (empty)",
       "0000000000000000000000000000000000000000000000000000000000000000",
       "000000000000000000000000", "", "", "", "530f8afbc74536b9a963b4f1c4cb738b"},
      {"GCM case 14 (one block)",
       "0000000000000000000000000000000000000000000000000000000000000000",
       "000000000000000000000000", "", "00000000000000000000000000000000",
       "cea7403d4d606b6e074ec5d3baf39d18", "d0d1c8a799996bf0265b98b5d48ab919"},
      {"GCM case 15 (four blocks, no aad)",
       "feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308",
       "cafebabefacedbaddecaf888", "",
       "d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c9595680953"
       "2fcf0e2449a6b525b16aedf5aa0de657ba637b391aafd255",
       "522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3d"
       "a7b08b1056828838c5f61e6393ba7a0abcc9f662898015ad",
       "b094dac5d93471bdec1a502270e3cc6c"},
      {"GCM case 16 (aad, truncated plaintext)",
       "feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308",
       "cafebabefacedbaddecaf888", "feedfacedeadbeeffeedfacedeadbeefabaddad2",
       "d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c9595680953"
       "2fcf0e2449a6b525b16aedf5aa0de657ba637b39",
       "522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3d"
       "a7b08b1056828838c5f61e6393ba7a0abcc9f662",
       "76fc6ece0f4e1768cddf8853bb2d551b"},
  };
  for (size_t i = 0; i < sizeof cases / sizeof *cases; i++) run_gcm(&cases[i]);
}

/* A 12-byte IV takes the fast path and any other length is GHASH-derived;
 * both must agree with themselves across encrypt/decrypt, which is the
 * only self-check available without a published non-96-bit vector at this
 * key size. The corpus differential pins the values against Node. */
static void test_gcm_iv_lengths(void) {
  unsigned char key[32], iv[24], pt[40], ct[40], back[40], tag[16];
  unhex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4", key);
  for (size_t i = 0; i < sizeof pt; i++) pt[i] = (unsigned char)(i * 3 + 5);
  ScrGcm g;
  scr_gcm256_init(&g, key);
  const size_t lens[] = {1, 8, 12, 13, 16, 24};
  for (size_t li = 0; li < sizeof lens / sizeof *lens; li++) {
    const size_t n = lens[li];
    for (size_t i = 0; i < n; i++) iv[i] = (unsigned char)(i + 1);
    scr_gcm256_encrypt(&g, iv, n, NULL, 0, pt, sizeof pt, ct, tag);
    check_true("gcm round trip at this iv length",
               scr_gcm256_decrypt(&g, iv, n, NULL, 0, ct, sizeof pt, tag, 16, back));
    check("gcm round trip plaintext", back, pt, sizeof pt);
  }
}

/* The STREAMING context must agree with the one-shot it shares a core
 * with, at every split — including splits that land mid-block, which is
 * where a keystream that restarted per call or a GHASH that padded per
 * call would show. */
static void test_gcm_streaming(void) {
  unsigned char key[32], iv[12], aad[20], pt[70], ct1[70], ct2[70], t1[16], t2[16], back[70];
  unhex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4", key);
  for (int i = 0; i < 12; i++) iv[i] = (unsigned char)(i + 9);
  for (int i = 0; i < 20; i++) aad[i] = (unsigned char)(i * 3);
  for (int i = 0; i < 70; i++) pt[i] = (unsigned char)(i * 5 + 2);

  ScrGcm g;
  scr_gcm256_init(&g, key);
  scr_gcm256_encrypt(&g, iv, 12, aad, 20, pt, 70, ct1, t1);

  const size_t splits[][3] = {{0, 0, 70}, {1, 1, 68}, {15, 1, 54}, {16, 16, 38},
                              {17, 33, 20}, {70, 0, 0}, {35, 35, 0}};
  for (size_t s = 0; s < sizeof splits / sizeof *splits; s++) {
    ScrGcmCtx c;
    scr_gcm256_start(&c, key, iv, 12);
    /* aad in two pieces too, to exercise its buffer */
    scr_gcm256_aad(&c, aad, 7);
    scr_gcm256_aad(&c, aad + 7, 13);
    size_t off = 0;
    for (int p = 0; p < 3; p++) {
      scr_gcm256_stream(&c, false, pt + off, splits[s][p], ct2 + off);
      off += splits[s][p];
    }
    scr_gcm256_finish(&c, t2);
    check("streaming GCM ciphertext equals one-shot", ct2, ct1, 70);
    check("streaming GCM tag equals one-shot", t2, t1, 16);

    /* And the decrypt direction, in place. */
    ScrGcmCtx d;
    scr_gcm256_start(&d, key, iv, 12);
    scr_gcm256_aad(&d, aad, 20);
    memcpy(back, ct1, 70);
    off = 0;
    for (int p = 0; p < 3; p++) {
      scr_gcm256_stream(&d, true, back + off, splits[s][p], back + off);
      off += splits[s][p];
    }
    scr_gcm256_finish(&d, t2);
    check("streaming GCM decrypt in place", back, pt, 70);
    check("streaming GCM decrypt tag", t2, t1, 16);
  }

  /* An aad-only message, and a message with neither. */
  ScrGcmCtx c;
  scr_gcm256_start(&c, key, iv, 12);
  scr_gcm256_aad(&c, aad, 20);
  scr_gcm256_finish(&c, t2);
  scr_gcm256_encrypt(&g, iv, 12, aad, 20, NULL, 0, NULL, t1);
  check("streaming GCM aad-only tag", t2, t1, 16);
  scr_gcm256_start(&c, key, iv, 12);
  scr_gcm256_finish(&c, t2);
  scr_gcm256_encrypt(&g, iv, 12, NULL, 0, NULL, 0, NULL, t1);
  check("streaming GCM empty tag", t2, t1, 16);
}

int main(void) {
  test_block();
  test_cbc_vectors();
  test_ctr_vectors();
  test_cbc_padding();
  test_gcm_vectors();
  test_gcm_iv_lengths();
  test_gcm_streaming();
  if (failures != 0) {
    printf("%d cipher assertion(s) failed\n", failures);
    return 1;
  }
  printf("cipher ok\n");
  return 0;
}
