/* The Cipher / Decipher HANDLE — createCipheriv's value, over the AES
 * primitive in scr_cipher.c.
 *
 * This is a separate translation unit from the primitive ON PURPOSE:
 * scr_cipher.c knows nothing about ScrBytes, so test_cipher.c can compile
 * the AES alone and a failing vector can only mean AES is wrong. Both
 * units are linked together by the same cipher gate in cc.ts.
 *
 * The hard requirement here is not the cryptography — that is settled and
 * pinned — but Node's CHUNKING. `update()` must return the same bytes at
 * the same call Node's does, because a caller that concatenates cannot
 * tell the difference but a caller that measures can:
 *   CTR and GCM are stream ciphers: update returns exactly its input
 *     length, final returns empty.
 *   CBC ENCRYPT returns whole buffered blocks from update and the padded
 *     last block (always 16 bytes) from final.
 *   CBC DECRYPT keeps a block back for final to unpad, but only when the
 *     buffer lands exactly on a block boundary — a leftover byte proves
 *     more is coming and nothing needs holding. (An earlier draft held one
 *     back unconditionally; the differential caught it.)
 *
 * GCM decryption hands back plaintext from update() BEFORE the tag is
 * checked, which is what Node does and therefore what this must do. (The
 * ONE-SHOT scr_gcm256_decrypt in the primitive does the opposite and
 * writes nothing until it verifies — different function, different
 * contract, and the one with a choice takes the safe side.) */
#include "scr_cipher.h"
#include "scr_runtime.h"

#include <stdlib.h>
#include <string.h>

enum { SCR_CMODE_GCM = 0, SCR_CMODE_CBC = 1, SCR_CMODE_CTR = 2 };

struct ScrCipher {
  size_t rc;
  int mode;
  bool decrypt;
  bool finished;
  /* CBC/CTR keep the bare block cipher; GCM keeps its streaming context. */
  ScrAes256 aes;
  ScrGcmCtx gcm;
  unsigned char iv[SCR_AES_BLOCK]; /* CBC chain / CTR counter, live */
  unsigned char part[SCR_AES_BLOCK]; /* CBC: bytes short of a block */
  size_t partlen;
  unsigned char tag[SCR_GCM_TAG];
  size_t taglen;
  bool has_tag;   /* setAuthTag arrived (decrypt) / getAuthTag ready (encrypt) */
  bool saw_data;  /* setAAD after update is Node's "unsupported state" */
};

static void scr_cipher_throw(const char *msg) {
  scr_throw_error_msg(SCR_ERR_ERROR, msg, strlen(msg));
}

/* An empty Buffer — what update() answers when nothing is ready and what
 * final() answers for the stream modes. */
static ScrBytes *scr_cipher_empty(void) {
  return scr_bytes_new(SCR_BYTES_U8, 0);
}

static ScrBytes *scr_cipher_bytes(const unsigned char *p, size_t n) {
  ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, (double)n);
  if (n > 0) memcpy(b->data, p, n);
  return b;
}

/* The three algorithm names the frontend admits; the mode is the suffix. */
static int scr_cipher_mode_of(const ScrStr *alg) {
  if (alg->len == 11 && memcmp(alg->data, "aes-256-gcm", 11) == 0) return SCR_CMODE_GCM;
  if (alg->len == 11 && memcmp(alg->data, "aes-256-cbc", 11) == 0) return SCR_CMODE_CBC;
  return SCR_CMODE_CTR;
}

ScrCipher *scr_cipher_new_raw(ScrStr *alg, const unsigned char *key, size_t keylen,
                              const unsigned char *iv, size_t ivlen, bool decrypt) {
  const int mode = scr_cipher_mode_of(alg);
  /* Node's own two argument errors, by their own messages. */
  if (keylen != SCR_AES256_KEY) {
    scr_cipher_throw("Invalid key length");
    return NULL;
  }
  if (mode == SCR_CMODE_GCM ? ivlen == 0 : ivlen != SCR_AES_BLOCK) {
    scr_cipher_throw("Invalid initialization vector");
    return NULL;
  }
  ScrCipher *c = calloc(1, sizeof(ScrCipher));
  if (!c) scr_trap("scriptc: out of memory\n");
  c->rc = 1;
  c->mode = mode;
  c->decrypt = decrypt;
  if (mode == SCR_CMODE_GCM) {
    scr_gcm256_start(&c->gcm, key, iv, ivlen);
  } else {
    scr_aes256_init(&c->aes, key);
    memcpy(c->iv, iv, SCR_AES_BLOCK);
  }
  return c;
}

ScrCipher *scr_cipher_new_bytes(ScrStr *alg, ScrBytes *key, ScrBytes *iv, bool decrypt) {
  return scr_cipher_new_raw(alg, key->data, key->len * scr_bytes_elem_size(key->elem), iv->data,
                            iv->len * scr_bytes_elem_size(iv->elem), decrypt);
}

ScrCipher *scr_cipher_retain(ScrCipher *c) {
  if (c && c->rc != SIZE_MAX) c->rc++;
  return c;
}

void scr_cipher_release(ScrCipher *c) {
  if (!c || c->rc == SIZE_MAX) return;
  if (--c->rc == 0) {
    /* The key schedule and the chaining state are secrets. */
    memset(c, 0, sizeof *c);
    free(c);
  }
}

void *scr_cipher_retain_v(void *c) { return scr_cipher_retain((ScrCipher *)c); }
void scr_cipher_release_v(void *c) { scr_cipher_release((ScrCipher *)c); }

/* setAAD — GCM only, and only before the first update, which is Node's
 * rule too. Answers the handle so `c.setAAD(a).update(b)` reads. */
ScrCipher *scr_cipher_set_aad(ScrCipher *c, ScrBytes *aad) {
  if (c->mode != SCR_CMODE_GCM || c->saw_data || c->finished) {
    scr_cipher_throw("Attempting to set AAD in unsupported state");
    return NULL;
  }
  scr_gcm256_aad(&c->gcm, aad->data, aad->len * scr_bytes_elem_size(aad->elem));
  return scr_cipher_retain(c);
}

ScrBytes *scr_cipher_update(ScrCipher *c, ScrBytes *data) {
  if (c->finished) {
    scr_cipher_throw("Trying to add data in unsupported state");
    return NULL;
  }
  const unsigned char *in = data->data;
  const size_t n = data->len * scr_bytes_elem_size(data->elem);
  c->saw_data = true;

  if (c->mode == SCR_CMODE_CTR) {
    ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)n);
    if (n > 0) scr_aes256_ctr(&c->aes, c->iv, in, n, out->data);
    return out;
  }
  if (c->mode == SCR_CMODE_GCM) {
    ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)n);
    if (n > 0) scr_gcm256_stream(&c->gcm, c->decrypt, in, n, out->data);
    return out;
  }

  /* CBC. Everything below is block bookkeeping: the cryptography is one
   * call per whole block. */
  const size_t avail = c->partlen + n;
  if (!c->decrypt) {
    /* Encrypt: emit every whole block, keep the remainder. */
    const size_t blocks = avail / SCR_AES_BLOCK;
    ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)(blocks * SCR_AES_BLOCK));
    size_t produced = 0, consumed = 0;
    unsigned char blk[SCR_AES_BLOCK];
    for (size_t b = 0; b < blocks; b++) {
      size_t k = 0;
      while (k < SCR_AES_BLOCK && k < c->partlen) { blk[k] = c->part[k]; k++; }
      const size_t from_part = k;
      while (k < SCR_AES_BLOCK) { blk[k] = in[consumed + k - from_part]; k++; }
      consumed += SCR_AES_BLOCK - from_part;
      if (from_part > 0) {
        memmove(c->part, c->part + from_part, c->partlen - from_part);
        c->partlen -= from_part;
      }
      scr_aes256_cbc_encrypt(&c->aes, c->iv, blk, SCR_AES_BLOCK, out->data + produced);
      produced += SCR_AES_BLOCK;
    }
    const size_t rest = n - consumed;
    memcpy(c->part + c->partlen, in + consumed, rest);
    c->partlen += rest;
    return out;
  }
  /* Decrypt. A block must be left for final() to unpad, but NOT always
   * one: Node (OpenSSL) emits every whole block it has UNLESS the buffer
   * lands exactly on a boundary, in which case the last block stays back
   * because it might be the one carrying the pad. A leftover byte proves
   * more is coming, so nothing needs holding then.
   *
   *   avail = 17  -> one whole block, one byte over: emit 16
   *   avail = 64  -> exactly four blocks: emit 48, keep 16
   *
   * Getting this wrong is invisible to a caller that concatenates and
   * plain wrong to one that measures; the differential against Node is
   * what pinned it, and an earlier draft that always held one block back
   * is what it caught. */
  size_t blocks = avail / SCR_AES_BLOCK;
  if (blocks > 0 && avail % SCR_AES_BLOCK == 0) blocks--;
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)(blocks * SCR_AES_BLOCK));
  size_t produced = 0, consumed = 0;
  unsigned char blk[SCR_AES_BLOCK];
  for (size_t b = 0; b < blocks; b++) {
    size_t k = 0;
    while (k < SCR_AES_BLOCK && k < c->partlen) { blk[k] = c->part[k]; k++; }
    const size_t from_part = k;
    while (k < SCR_AES_BLOCK) { blk[k] = in[consumed + k - from_part]; k++; }
    consumed += SCR_AES_BLOCK - from_part;
    if (from_part > 0) {
      memmove(c->part, c->part + from_part, c->partlen - from_part);
      c->partlen -= from_part;
    }
    scr_aes256_cbc_decrypt(&c->aes, c->iv, blk, SCR_AES_BLOCK, out->data + produced);
    produced += SCR_AES_BLOCK;
  }
  const size_t rest = n - consumed;
  memcpy(c->part + c->partlen, in + consumed, rest);
  c->partlen += rest;
  return out;
}

ScrBytes *scr_cipher_final(ScrCipher *c) {
  if (c->finished) {
    scr_cipher_throw("Trying to add data in unsupported state");
    return NULL;
  }
  c->finished = true;

  if (c->mode == SCR_CMODE_CTR) return scr_cipher_empty();
  if (c->mode == SCR_CMODE_GCM) {
    unsigned char want[SCR_GCM_TAG];
    scr_gcm256_finish(&c->gcm, want);
    if (!c->decrypt) {
      memcpy(c->tag, want, SCR_GCM_TAG);
      c->taglen = SCR_GCM_TAG;
      c->has_tag = true;
      return scr_cipher_empty();
    }
    if (!c->has_tag) {
      scr_cipher_throw("Unsupported state or unable to authenticate data");
      return NULL;
    }
    unsigned char diff = 0;
    for (size_t i = 0; i < c->taglen; i++) diff = (unsigned char)(diff | (want[i] ^ c->tag[i]));
    if (diff != 0) {
      scr_cipher_throw("Unsupported state or unable to authenticate data");
      return NULL;
    }
    return scr_cipher_empty();
  }

  /* CBC. */
  if (!c->decrypt) {
    unsigned char blk[SCR_AES_BLOCK], out[SCR_AES_BLOCK];
    const unsigned char pad = (unsigned char)(SCR_AES_BLOCK - c->partlen);
    memcpy(blk, c->part, c->partlen);
    memset(blk + c->partlen, pad, SCR_AES_BLOCK - c->partlen);
    scr_aes256_cbc_encrypt(&c->aes, c->iv, blk, SCR_AES_BLOCK, out);
    return scr_cipher_bytes(out, SCR_AES_BLOCK);
  }
  if (c->partlen != SCR_AES_BLOCK) {
    /* A trailing partial block, or nothing at all: Node's bad decrypt. */
    scr_cipher_throw("error:1C800064:Provider routines::bad decrypt");
    return NULL;
  }
  unsigned char out[SCR_AES_BLOCK];
  scr_aes256_cbc_decrypt(&c->aes, c->iv, c->part, SCR_AES_BLOCK, out);
  const unsigned char pad = out[SCR_AES_BLOCK - 1];
  if (pad == 0 || pad > SCR_AES_BLOCK) {
    scr_cipher_throw("error:1C800064:Provider routines::bad decrypt");
    return NULL;
  }
  for (size_t i = 0; i < pad; i++) {
    if (out[SCR_AES_BLOCK - 1 - i] != pad) {
      scr_cipher_throw("error:1C800064:Provider routines::bad decrypt");
      return NULL;
    }
  }
  return scr_cipher_bytes(out, SCR_AES_BLOCK - pad);
}

ScrBytes *scr_cipher_get_auth_tag(ScrCipher *c) {
  if (c->mode != SCR_CMODE_GCM || c->decrypt || !c->has_tag) {
    scr_cipher_throw("Attempting to get auth tag in unsupported state");
    return NULL;
  }
  return scr_cipher_bytes(c->tag, c->taglen);
}

ScrCipher *scr_cipher_set_auth_tag(ScrCipher *c, ScrBytes *tag) {
  const size_t n = tag->len * scr_bytes_elem_size(tag->elem);
  if (c->mode != SCR_CMODE_GCM || !c->decrypt || c->finished) {
    scr_cipher_throw("Attempting to set auth tag in unsupported state");
    return NULL;
  }
  /* Node accepts 4, 8 and 13..16 for GCM; anything else is an error. */
  if (!(n == 4 || n == 8 || (n >= 13 && n <= 16))) {
    scr_cipher_throw("Invalid authentication tag length");
    return NULL;
  }
  memcpy(c->tag, tag->data, n);
  c->taglen = n;
  c->has_tag = true;
  return scr_cipher_retain(c);
}
