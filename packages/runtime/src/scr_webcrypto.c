/* WebCrypto (gated: cc.ts links this TU only when the IR carries a
 * dyn.webCrypto libCall, i.e. globalThis.crypto, require('crypto').webcrypto
 * or the SubtleCrypto digest/importKey/sign/deriveBits surface). Its promises
 * ride scr_dyn_new_promise and its SHA-3 ExperimentalWarning rides
 * scr_emit_warning, both in the gated async unit scr_async_dyn.c, so a
 * program that never names WebCrypto owes the linker neither. The always
 * linked scr_lib.c keeps only the CryptoKey constructor-name constant that
 * scr_inspect.c reads. */
#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Node's CryptoKey constructor name, by identity: the keys are stamped with this
 * pointer and the inspect hook below matches on it, so a user class named
 * CryptoKey keeps the ordinary rule. */
const char scr_wc_key_cname[] = "CryptoKey";

/* The SHA-1/256 cores (scr_lib.c, non-static since the digests share it). */
size_t scr_crypto_digest_raw(const char *alg, const unsigned char *data, size_t len, unsigned char out[32]);

/* The three method/accessor constructors the WebCrypto object needs (the
 * same shapes scr_json.c builds the Uint8Array statics with). Local here so
 * this unit carries no link edge into scr_json.c. */
static ScrDyn *scr_wc_new_func(const char *name, ScrDynThunk thunk, uint32_t arity) {
  return scr_dyn_new_func(scr_closure_new((void *)thunk, 0), thunk, arity, "()", name);
}

static void scr_wc_define_method(ScrDyn *target, const char *name, ScrDynThunk thunk, uint32_t arity) {
  ScrDyn *f = scr_wc_new_func(name, thunk, arity); /* +1 */
  scr_dyn_obj_define_hidden_data(target, name, strlen(name), f, true, true);
  scr_dyn_release(f);
}

static void scr_wc_define_getter(ScrDyn *target, const char *name, ScrDynThunk thunk) {
  ScrDyn *g = scr_wc_new_func(name, thunk, 0); /* +1 */
  scr_dyn_obj_define_accessor(target, name, strlen(name), g, scr_dyn_undefined(), true, false);
  scr_dyn_release(g);
}

/* ── globalThis.crypto (the WebCrypto object) as a value ─────────────────
 * One process singleton, so `globalThis.crypto === crypto` and
 * `require('crypto').webcrypto === globalThis.crypto` both hold. getRandomValues
 * fills an integer TypedArray in place from the arc4random_buf CSPRNG and
 * randomUUID answers the same UUID.
 *
 * `subtle` is the SubtleCrypto singleton for digest (SHA-1/256/384/512 and
 * SHA3-256/384/512), importKey (raw HMAC and PBKDF2 keys), sign (HMAC) and
 * deriveBits (PBKDF2). The compiler refuses, at compile time, every algorithm,
 * hash or format argument it cannot prove is one of these (lower-exprs), so
 * the only names reaching here are these. Argument conversion follows WebIDL's
 * order (format, keyData, usages, the CryptoKey, the data BufferSource, then
 * the dictionary members alphabetically, then the semantic checks), and every
 * failure is a rejection with Node's DOMException or TypeError name, code and
 * message (measured against Node 24.15.0; see lab/m in the slice). */

static ScrDyn *scr_wc_obj;
static ScrDyn *scr_wc_subtle_obj;

/* Node's Object.prototype.toString tag: the compiler's well-known toStringTag
 * member (scr_copying.c reads it). Hidden. */
static ScrDyn *scr_wc_str(const char *lit, size_t n) {
  ScrStr *x = scr_str_new(lit, n);
  ScrDyn *d = scr_dyn_new_str(x); /* retains x */
  scr_str_release(x);
  return d;
}

static void scr_wc_tag(ScrDyn *obj, const char *tag) {
  ScrDyn *v = scr_wc_str(tag, strlen(tag));
  scr_dyn_obj_define_hidden_data(obj, "__@toStringTag@1", 16, v, false, true);
  scr_dyn_release(v);
}

static void scr_wc_teardown(void) {
  scr_dyn_release(scr_wc_subtle_obj);
  scr_wc_subtle_obj = NULL;
  scr_dyn_release(scr_wc_obj);
  scr_wc_obj = NULL;
}

/* BYTES views (typed arrays, Buffers, DataViews) and ArrayBuffers hold their
 * bytes in a ScrBytes; the byte length is len times the element width. */
static bool scr_wc_bytes_of(const ScrDyn *d, const unsigned char **p, size_t *n) {
  if (d == NULL || d->v.bytes == NULL) return false;
  if (d->kind != SCR_DYN_BYTES && d->kind != SCR_DYN_ARRBUF) return false;
  *p = d->v.bytes->data;
  *n = d->v.bytes->len * scr_bytes_elem_size(d->v.bytes->elem);
  return true;
}

/* The checks and the fill of getRandomValues, shared by the dyn method and the
 * static libCall. Node's integer-typed test: Float16Array (SCR_BYTES_F16)
 * is a float array, so it throws like Float32Array and Float64Array; an
 * ArrayBuffer and a DataView are not typed arrays at all. Returns false with
 * the Node error thrown. */
static bool scr_wc_fill_random(ScrBytes *b) {
  if (b == NULL || b->elem == SCR_BYTES_F32 || b->elem == SCR_BYTES_F64 ||
      b->elem == SCR_BYTES_F16 || b->elem == SCR_BYTES_BUF || scr_bytes_is_dataview(b)) {
    scr_throw_domex("TypeMismatchError", "The data argument must be an integer-type TypedArray");
    return false;
  }
  size_t n = b->len * scr_bytes_elem_size(b->elem);
  if (n > 65536) {
    scr_throw_domex("QuotaExceededError", "The requested length exceeds 65,536 bytes");
    return false;
  }
  if (n > 0) arc4random_buf(b->data, n);
  return true;
}

static ScrDyn *scr_wc_get_random_values(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (argc < 1) {
    static const char msg[] = "Failed to execute 'getRandomValues' on 'Crypto': 1 argument required, but only 0 present.";
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, sizeof msg - 1, "ERR_MISSING_ARGS");
    return NULL;
  }
  const ScrDyn *ta = args[0];
  if (ta == NULL || ta->kind != SCR_DYN_BYTES || ta->v.bytes == NULL) {
    scr_throw_domex("TypeMismatchError", "The data argument must be an integer-type TypedArray");
    return NULL;
  }
  if (!scr_wc_fill_random(ta->v.bytes)) return NULL;
  return scr_dyn_retain((ScrDyn *)ta);
}

/* crypto.getRandomValues(a) over a static typed array (the libCall the
 * lowering emits for a call whose argument is statically a typed array). The
 * argument is borrowed; the answer is the SAME array, retained (+1), so
 * `getRandomValues(a) === a` holds as it does in Node. */
ScrBytes *scr_crypto_get_random_values(ScrBytes *b) {
  if (!scr_wc_fill_random(b)) return NULL;
  return scr_bytes_retain(b);
}

static ScrDyn *scr_wc_random_uuid(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  (void)args;
  (void)argc;
  ScrStr *s = scr_crypto_random_uuid(); /* +1 */
  ScrDyn *d = scr_dyn_new_str(s);       /* retains its own reference */
  scr_str_release(s);
  return d;
}

/* ── settle-later rejections and fulfilments ───────────────────────────── */

enum { WC_ERR_DOM = 0, WC_ERR_TYPE = 1 };

/* caps: [0] promise box, [1] payload dyn (fulfil), [2] kind (F64),
 * [3] DOMException name or TypeError code (ScrStr), [4] message (ScrStr). */
static void scr_wc_settle_ok(ScrClosure *self) {
  ScrPromise *p = (ScrPromise *)scr_box_get_ref(self->caps[0]); /* +1 */
  ScrDyn *v = (ScrDyn *)scr_box_get_ref(self->caps[1]);         /* +1, moves into the promise */
  scr_promise_fulfill_ref(p, v, scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_promise_release(p);
}

static void scr_wc_settle_err(ScrClosure *self) {
  ScrPromise *p = (ScrPromise *)scr_box_get_ref(self->caps[0]); /* +1 */
  int kind = (int)scr_box_get_f64(self->caps[2]);
  ScrStr *nc = (ScrStr *)scr_box_get_ref(self->caps[3]);        /* +1 */
  ScrStr *m = (ScrStr *)scr_box_get_ref(self->caps[4]);         /* +1 */
  char *ncb = malloc(nc->len + 1);
  char *mb = malloc(m->len + 1);
  if (ncb == NULL || mb == NULL) scr_bytes_io_oom();
  memcpy(ncb, nc->data, nc->len);
  ncb[nc->len] = '\0';
  memcpy(mb, m->data, m->len);
  mb[m->len] = '\0';
  if (kind == WC_ERR_TYPE) scr_throw_error_msg_code(SCR_ERR_TYPE, mb, m->len, ncb);
  else scr_throw_domex(ncb, mb);
  free(ncb);
  free(mb);
  scr_str_release(nc);
  scr_str_release(m);
  scr_promise_reject_pending(p);
  scr_promise_release(p);
}

/* A promise that fulfils with `v` (borrowed) in a later turn. +1. */
static ScrDyn *scr_wc_resolve_later(ScrDyn *v) {
  ScrPromise *p = scr_promise_new(); /* +1, ours */
  ScrClosure *cl = scr_closure_new((void *)scr_wc_settle_ok, 2);
  ScrBox *pb = scr_box_new_obj(&scr_promise_retain_v, &scr_promise_release_v, NULL);
  scr_box_set_ref(pb, scr_promise_retain(p));
  ScrBox *vb = scr_box_new_obj(&scr_dyn_retain_v, &scr_dyn_release_v, NULL);
  scr_box_set_ref(vb, scr_dyn_retain(v));
  cl->caps[0] = pb;
  cl->caps[1] = vb;
  scr_set_immediate(cl);
  ScrDyn *d = scr_dyn_new_promise(p);
  scr_promise_release(p);
  return d;
}

/* A promise that rejects in a later turn with DOMException `name` (kind DOM)
 * or a TypeError with `code` (kind TYPE). The message is copied. +1. */
static ScrDyn *scr_wc_reject_later(int kind, const char *nc, const char *msg) {
  ScrPromise *p = scr_promise_new();
  ScrClosure *c = scr_closure_new((void *)scr_wc_settle_err, 5);
  ScrBox *pb = scr_box_new_obj(&scr_promise_retain_v, &scr_promise_release_v, NULL);
  scr_box_set_ref(pb, scr_promise_retain(p));
  ScrBox *kb = scr_box_new(SCR_BOX_F64);
  scr_box_set_f64(kb, (double)kind);
  ScrBox *nb = scr_box_new_obj(&scr_str_retain_v, &scr_str_release_v, NULL);
  ScrStr *ns = scr_str_new(nc, strlen(nc));
  scr_box_set_ref(nb, ns); /* the box takes the new string's reference */
  ScrBox *mb = scr_box_new_obj(&scr_str_retain_v, &scr_str_release_v, NULL);
  ScrStr *ms = scr_str_new(msg, strlen(msg));
  scr_box_set_ref(mb, ms);
  c->caps[0] = pb;
  c->caps[1] = scr_box_new(SCR_BOX_F64); /* unused slot, kept for the ok/err layout */
  c->caps[2] = kb;
  c->caps[3] = nb;
  c->caps[4] = mb;
  scr_set_immediate(c);
  ScrDyn *d = scr_dyn_new_promise(p);
  scr_promise_release(p);
  return d;
}

/* Node's messages with the operation name in them. */
static ScrDyn *scr_wc_reject_args(const char *op, size_t need, size_t have) {
  char buf[256];
  snprintf(buf, sizeof buf, "Failed to execute '%s' on 'SubtleCrypto': %zu arguments required, but only %zu present.",
           op, need, have);
  return scr_wc_reject_later(WC_ERR_TYPE, "ERR_MISSING_ARGS", buf);
}

static ScrDyn *scr_wc_reject_data(const char *op, const char *which) {
  char buf[256];
  snprintf(buf, sizeof buf,
           "Failed to execute '%s' on 'SubtleCrypto': %s argument is not instance of ArrayBuffer, Buffer, TypedArray, or DataView.",
           op, which);
  return scr_wc_reject_later(WC_ERR_TYPE, "ERR_INVALID_ARG_TYPE", buf);
}

static ScrDyn *scr_wc_reject_key(const char *op) {
  char buf[256];
  snprintf(buf, sizeof buf, "Failed to execute '%s' on 'SubtleCrypto': 2nd argument is not of type CryptoKey.", op);
  return scr_wc_reject_later(WC_ERR_TYPE, "ERR_INVALID_ARG_TYPE", buf);
}

/* ── SHA-1/256/384/512 and SHA3-256/384/512 digests and their HMAC/PBKDF2 ── */

typedef enum {
  WC_SHA1 = 0, WC_SHA256, WC_SHA384, WC_SHA512, WC_SHA3_256, WC_SHA3_384, WC_SHA3_512
} WcHash;

static size_t wc_hash_out(WcHash h) {
  switch (h) {
  case WC_SHA1: return 20;
  case WC_SHA256: case WC_SHA3_256: return 32;
  case WC_SHA384: case WC_SHA3_384: return 48;
  default: return 64;
  }
}

/* The HMAC block size: the hash's block, or the Keccak rate for SHA-3. */
static size_t wc_hash_block(WcHash h) {
  switch (h) {
  case WC_SHA384: case WC_SHA512: return 128;
  case WC_SHA3_256: return 136;
  case WC_SHA3_384: return 104;
  case WC_SHA3_512: return 72;
  default: return 64;
  }
}

/* Keccak-f[1600] (FIPS 202 section 3.3). Lane (x,y) is s[x + 5y]. */
static uint64_t wc_rotl64(uint64_t v, unsigned n) {
  return n == 0 ? v : (v << n) | (v >> (64 - n));
}

static void wc_keccak_f(uint64_t s[25]) {
  static const uint64_t RC[24] = {
    0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL, 0x8000000080008000ULL,
    0x000000000000808bULL, 0x0000000080000001ULL, 0x8000000080008081ULL, 0x8000000000008009ULL,
    0x000000000000008aULL, 0x0000000000000088ULL, 0x0000000080008009ULL, 0x000000008000000aULL,
    0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL, 0x8000000000008003ULL,
    0x8000000000008002ULL, 0x8000000000000080ULL, 0x000000000000800aULL, 0x800000008000000aULL,
    0x8000000080008081ULL, 0x8000000000008080ULL, 0x0000000080000001ULL, 0x8000000080008008ULL };
  static const unsigned R[25] = {
    0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14 };
  for (int round = 0; round < 24; round++) {
    uint64_t C[5], D[5], B[25];
    for (int x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    for (int x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ wc_rotl64(C[(x + 1) % 5], 1);
    for (int i = 0; i < 25; i++) s[i] ^= D[i % 5];
    for (int x = 0; x < 5; x++)
      for (int y = 0; y < 5; y++)
        B[y + 5 * ((2 * x + 3 * y) % 5)] = wc_rotl64(s[x + 5 * y], R[x + 5 * y]);
    for (int y = 0; y < 5; y++)
      for (int x = 0; x < 5; x++)
        s[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y]) & B[(x + 2) % 5 + 5 * y]);
    s[0] ^= RC[round];
  }
}

/* SHA-3 (FIPS 202): absorb at `rate` bytes with the 0x06 ... 0x80 padding,
 * squeeze `outlen` (<= rate) bytes. */
static size_t wc_sha3(size_t rate, size_t outlen, const unsigned char *p, size_t n, unsigned char out[64]) {
  uint64_t st[25];
  memset(st, 0, sizeof st);
  while (n >= rate) {
    for (size_t i = 0; i < rate; i++) st[i / 8] ^= (uint64_t)p[i] << (8 * (i % 8));
    wc_keccak_f(st);
    p += rate;
    n -= rate;
  }
  unsigned char blk[200];
  memset(blk, 0, sizeof blk);
  if (n > 0) memcpy(blk, p, n);
  blk[n] ^= 0x06;
  blk[rate - 1] ^= 0x80;
  for (size_t i = 0; i < rate; i++) st[i / 8] ^= (uint64_t)blk[i] << (8 * (i % 8));
  wc_keccak_f(st);
  for (size_t i = 0; i < outlen; i++) out[i] = (unsigned char)(st[i / 8] >> (8 * (i % 8)));
  return outlen;
}

/* Host byte order for the SHA-512 words (scr_lib.c keeps its own copy of this). */
#if defined(__BYTE_ORDER__) && __BYTE_ORDER__ == __ORDER_BIG_ENDIAN__
#define SCR_HOST_BIG_ENDIAN 1
#else
#define SCR_HOST_BIG_ENDIAN 0
#endif

static uint64_t wc_be64_load(const unsigned char *p) {
  uint64_t v;
  memcpy(&v, p, 8);
  return SCR_HOST_BIG_ENDIAN ? v : __builtin_bswap64(v);
}
static void wc_be64_store(unsigned char *p, uint64_t v) {
  uint64_t o = SCR_HOST_BIG_ENDIAN ? v : __builtin_bswap64(v);
  memcpy(p, &o, 8);
}

static const uint64_t wc_sha512_k[80] = {
    0x428a2f98d728ae22ULL, 0x7137449123ef65cdULL, 0xb5c0fbcfec4d3b2fULL,
    0xe9b5dba58189dbbcULL, 0x3956c25bf348b538ULL, 0x59f111f1b605d019ULL,
    0x923f82a4af194f9bULL, 0xab1c5ed5da6d8118ULL, 0xd807aa98a3030242ULL,
    0x12835b0145706fbeULL, 0x243185be4ee4b28cULL, 0x550c7dc3d5ffb4e2ULL,
    0x72be5d74f27b896fULL, 0x80deb1fe3b1696b1ULL, 0x9bdc06a725c71235ULL,
    0xc19bf174cf692694ULL, 0xe49b69c19ef14ad2ULL, 0xefbe4786384f25e3ULL,
    0x0fc19dc68b8cd5b5ULL, 0x240ca1cc77ac9c65ULL, 0x2de92c6f592b0275ULL,
    0x4a7484aa6ea6e483ULL, 0x5cb0a9dcbd41fbd4ULL, 0x76f988da831153b5ULL,
    0x983e5152ee66dfabULL, 0xa831c66d2db43210ULL, 0xb00327c898fb213fULL,
    0xbf597fc7beef0ee4ULL, 0xc6e00bf33da88fc2ULL, 0xd5a79147930aa725ULL,
    0x06ca6351e003826fULL, 0x142929670a0e6e70ULL, 0x27b70a8546d22ffcULL,
    0x2e1b21385c26c926ULL, 0x4d2c6dfc5ac42aedULL, 0x53380d139d95b3dfULL,
    0x650a73548baf63deULL, 0x766a0abb3c77b2a8ULL, 0x81c2c92e47edaee6ULL,
    0x92722c851482353bULL, 0xa2bfe8a14cf10364ULL, 0xa81a664bbc423001ULL,
    0xc24b8b70d0f89791ULL, 0xc76c51a30654be30ULL, 0xd192e819d6ef5218ULL,
    0xd69906245565a910ULL, 0xf40e35855771202aULL, 0x106aa07032bbd1b8ULL,
    0x19a4c116b8d2d0c8ULL, 0x1e376c085141ab53ULL, 0x2748774cdf8eeb99ULL,
    0x34b0bcb5e19b48a8ULL, 0x391c0cb3c5c95a63ULL, 0x4ed8aa4ae3418acbULL,
    0x5b9cca4f7763e373ULL, 0x682e6ff3d6b2b8a3ULL, 0x748f82ee5defb2fcULL,
    0x78a5636f43172f60ULL, 0x84c87814a1f0ab72ULL, 0x8cc702081a6439ecULL,
    0x90befffa23631e28ULL, 0xa4506cebde82bde9ULL, 0xbef9a3f7b2c67915ULL,
    0xc67178f2e372532bULL, 0xca273eceea26619cULL, 0xd186b8c721c0c207ULL,
    0xeada7dd6cde0eb1eULL, 0xf57d4f7fee6ed178ULL, 0x06f067aa72176fbaULL,
    0x0a637dc5a2c898a6ULL, 0x113f9804bef90daeULL, 0x1b710b35131c471bULL,
    0x28db77f523047d84ULL, 0x32caab7b40c72493ULL, 0x3c9ebe0a15c9bebcULL,
    0x431d67c49c100d4cULL, 0x4cc5d4becb3e42b6ULL, 0x597f299cfc657e2aULL,
    0x5fcb6fab3ad6faecULL, 0x6c44198c4a475817ULL};

static uint64_t wc_sha512_rotr(uint64_t x, unsigned n) {
  return (x >> n) | (x << (64 - n));
}

static void wc_sha512_block(uint64_t h[8], const unsigned char *p) {
  uint64_t w[80];
  /* Eight byte loads and eight shift-or steps per word became one load and
   * one swap. SHA-512 has no hardware on this host, so unlike SHA-256 it is
   * still the scalar code that ships here. */
  for (int i = 0; i < 16; i++) w[i] = wc_be64_load(p + i * 8);
  for (int i = 16; i < 80; i++) {
    uint64_t s0 = wc_sha512_rotr(w[i - 15], 1) ^ wc_sha512_rotr(w[i - 15], 8) ^ (w[i - 15] >> 7);
    uint64_t s1 = wc_sha512_rotr(w[i - 2], 19) ^ wc_sha512_rotr(w[i - 2], 61) ^ (w[i - 2] >> 6);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint64_t a = h[0], b = h[1], c = h[2], d = h[3];
  uint64_t e = h[4], f = h[5], g = h[6], hh = h[7];
  for (int i = 0; i < 80; i++) {
    uint64_t s1 = wc_sha512_rotr(e, 14) ^ wc_sha512_rotr(e, 18) ^ wc_sha512_rotr(e, 41);
    uint64_t ch = (e & f) ^ (~e & g);
    uint64_t t1 = hh + s1 + ch + wc_sha512_k[i] + w[i];
    uint64_t s0 = wc_sha512_rotr(a, 28) ^ wc_sha512_rotr(a, 34) ^ wc_sha512_rotr(a, 39);
    uint64_t maj = (a & b) ^ (a & c) ^ (b & c);
    uint64_t t2 = s0 + maj;
    hh = g; g = f; f = e; e = d + t1;
    d = c; c = b; b = a; a = t1 + t2;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d;
  h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}

/* SHA-512 under a given initial hash value (FIPS 180-4 5.3.4 for SHA-384):
 * SHA-512 takes the 64-byte IV, SHA-384 its own IV and the first 48 bytes. */
static const uint64_t wc_iv512[8] = {0x6a09e667f3bcc908ULL, 0xbb67ae8584caa73bULL, 0x3c6ef372fe94f82bULL,
                                     0xa54ff53a5f1d36f1ULL, 0x510e527fade682d1ULL, 0x9b05688c2b3e6c1fULL,
                                     0x1f83d9abfb41bd6bULL, 0x5be0cd19137e2179ULL};
static const uint64_t wc_iv384[8] = {0xcbbb9d5dc1059ed8ULL, 0x629a292a367cd507ULL, 0x9159015a3070dd17ULL,
                                     0x152fecd8f70e5939ULL, 0x67332667ffc00b31ULL, 0x8eb44a8768581511ULL,
                                     0xdb0c2e0d64f98fa7ULL, 0x47b5481dbefa4fa4ULL};

static size_t wc_sha512_iv(const uint64_t iv[8], size_t outlen, const unsigned char *data, size_t len,
                           unsigned char out[64]) {
  uint64_t h[8];
  memcpy(h, iv, sizeof h);
  size_t i = 0;
  for (; i + 128 <= len; i += 128) wc_sha512_block(h, data + i);
  unsigned char tail[256];
  size_t rem = len - i;
  size_t pad = (rem + 1 + 16 <= 128) ? 128 : 256;
  memset(tail, 0, pad);
  memcpy(tail, data + i, rem);
  tail[rem] = 0x80;
  wc_be64_store(tail + pad - 8, (uint64_t)len * 8);
  wc_sha512_block(h, tail);
  if (pad == 256) wc_sha512_block(h, tail + 128);
  unsigned char full[64];
  for (int j = 0; j < 8; j++) wc_be64_store(full + j * 8, h[j]);
  memcpy(out, full, outlen);
  return outlen;
}

/* The digest core of each hash. out holds 64 bytes. Returns the digest length. */
static size_t wc_hash(WcHash h, const unsigned char *p, size_t n, unsigned char out[64]) {
  switch (h) {
  case WC_SHA1: return scr_crypto_digest_raw("sha1", p, n, out);
  case WC_SHA256: return scr_crypto_digest_raw("sha256", p, n, out);
  case WC_SHA384: return wc_sha512_iv(wc_iv384, 48, p, n, out);
  case WC_SHA512: return wc_sha512_iv(wc_iv512, 64, p, n, out);
  case WC_SHA3_256: return wc_sha3(136, 32, p, n, out);
  case WC_SHA3_384: return wc_sha3(104, 48, p, n, out);
  default: return wc_sha3(72, 64, p, n, out);
  }
}

/* HMAC(key, msg) per RFC 2104 over the block size of h. out holds 64 bytes. */
static size_t wc_hmac(WcHash h, const unsigned char *key, size_t klen, const unsigned char *msg,
                      size_t mlen, unsigned char out[64]) {
  size_t bs = wc_hash_block(h);
  unsigned char kblock[200];
  unsigned char kd[64];
  memset(kblock, 0, sizeof kblock);
  if (klen > bs) {
    size_t kn = wc_hash(h, key, klen, kd);
    memcpy(kblock, kd, kn);
  } else if (klen > 0) {
    memcpy(kblock, key, klen);
  }
  unsigned char *inner = malloc(bs + mlen);
  if (inner == NULL) scr_bytes_io_oom();
  for (size_t i = 0; i < bs; i++) inner[i] = kblock[i] ^ 0x36;
  if (mlen > 0) memcpy(inner + bs, msg, mlen); /* msg may alias out: read before any write */
  unsigned char ih[64];
  size_t in = wc_hash(h, inner, bs + mlen, ih);
  free(inner);
  unsigned char outer[200 + 64];
  for (size_t i = 0; i < bs; i++) outer[i] = kblock[i] ^ 0x5c;
  memcpy(outer + bs, ih, in);
  return wc_hash(h, outer, bs + in, out);
}

/* PBKDF2 (RFC 8018) with HMAC over h; a fresh malloc'd buffer of `want` bytes. */
static unsigned char *wc_pbkdf2(WcHash h, const unsigned char *pw, size_t pwlen, const unsigned char *salt,
                                size_t slen, unsigned long iters, size_t want) {
  unsigned char *out = malloc(want > 0 ? want : 1);
  unsigned char *blk = malloc(slen + 4);
  if (out == NULL || blk == NULL) scr_bytes_io_oom();
  size_t hl = wc_hash_out(h);
  unsigned char u[64];
  unsigned char t[64];
  size_t done = 0;
  if (slen > 0) memcpy(blk, salt, slen);
  for (uint32_t i = 1; done < want; i++) {
    blk[slen] = (unsigned char)(i >> 24);
    blk[slen + 1] = (unsigned char)(i >> 16);
    blk[slen + 2] = (unsigned char)(i >> 8);
    blk[slen + 3] = (unsigned char)i;
    wc_hmac(h, pw, pwlen, blk, slen + 4, u);
    memcpy(t, u, hl);
    for (unsigned long j = 1; j < iters; j++) {
      wc_hmac(h, pw, pwlen, u, hl, u);
      for (size_t k = 0; k < hl; k++) t[k] ^= u[k];
    }
    size_t take = want - done < hl ? want - done : hl;
    memcpy(out + done, t, take);
    done += take;
  }
  free(blk);
  return out;
}

/* ── WebIDL conversions and dictionary helpers ─────────────────────────── */

/* ASCII case-insensitive equality of a ScrStr with a literal. */
static bool scr_wc_ieq(const ScrStr *s, const char *lit) {
  size_t n = strlen(lit);
  if (s->len != n) return false;
  for (size_t i = 0; i < n; i++) {
    unsigned char a = (unsigned char)s->data[i];
    unsigned char b = (unsigned char)lit[i];
    if (a >= 'A' && a <= 'Z') a = (unsigned char)(a + 32);
    if (b >= 'A' && b <= 'Z') b = (unsigned char)(b + 32);
    if (a != b) return false;
  }
  return true;
}

static bool scr_wc_hash_name_of(const ScrStr *s, WcHash *h) {
  if (scr_wc_ieq(s, "SHA-1")) { *h = WC_SHA1; return true; }
  if (scr_wc_ieq(s, "SHA-256")) { *h = WC_SHA256; return true; }
  if (scr_wc_ieq(s, "SHA-384")) { *h = WC_SHA384; return true; }
  if (scr_wc_ieq(s, "SHA-512")) { *h = WC_SHA512; return true; }
  if (scr_wc_ieq(s, "SHA3-256")) { *h = WC_SHA3_256; return true; }
  if (scr_wc_ieq(s, "SHA3-384")) { *h = WC_SHA3_384; return true; }
  if (scr_wc_ieq(s, "SHA3-512")) { *h = WC_SHA3_512; return true; }
  return false;
}

static const char *scr_wc_hash_name(WcHash h) {
  switch (h) {
  case WC_SHA1: return "SHA-1";
  case WC_SHA256: return "SHA-256";
  case WC_SHA384: return "SHA-384";
  case WC_SHA512: return "SHA-512";
  case WC_SHA3_256: return "SHA3-256";
  case WC_SHA3_384: return "SHA3-384";
  default: return "SHA3-512";
  }
}

/* Node's ExperimentalWarning for a SHA-3 Web Crypto algorithm, once per name
 * per process, at the call that normalises the hash (the warning dispatch
 * prints Node's report and its one-time trace hint). */
static void scr_wc_warn_sha3(WcHash h) {
  static bool warned[7];
  if (h < WC_SHA3_256 || warned[h]) return;
  warned[h] = true;
  char msg[160];
  snprintf(msg, sizeof msg, "The %s Web Crypto API algorithm is an experimental feature and might change at any time",
           scr_wc_hash_name(h));
  ScrStr *text = scr_str_new(msg, strlen(msg)); /* scr_emit_warning retains the message: drop ours */
  scr_emit_warning("ExperimentalWarning", NULL, text);
  scr_str_release(text);
}

/* A key's internal slots: "%kind" (0 HMAC, 1 PBKDF2), "%hash", "%key" (bytes),
 * and the four CryptoKey members kept for the inspect rendering. */
enum { WC_KEY_HMAC = 0, WC_KEY_PBKDF2 = 1 };

static bool scr_wc_is_key(const ScrDyn *k, int *kind) {
  if (k == NULL || k->kind != SCR_DYN_OBJ) return false;
  const ScrDyn *s = scr_dyn_obj_slot_get(k, "%kind", 5);
  if (s == NULL || s->kind != SCR_DYN_NUM) return false;
  *kind = (int)s->v.num;
  return true;
}

static bool scr_wc_is_arr(const ScrDyn *a) {
  return a != NULL && a->kind == SCR_DYN_ARR;
}

/* The WebIDL KeyUsage enumeration, in Node's order. */
static const char *const WC_USAGES[12] = {
  "encrypt", "decrypt", "sign", "verify", "deriveKey", "deriveBits",
  "wrapKey", "unwrapKey", "encapsulateKey", "encapsulateBits", "decapsulateKey", "decapsulateBits" };

static int scr_wc_usage_index(const ScrStr *s) {
  for (int i = 0; i < 12; i++) {
    size_t l = strlen(WC_USAGES[i]);
    if (s->len == l && memcmp(s->data, WC_USAGES[i], l) == 0) return i;
  }
  return -1;
}

/* Converts the keyUsages argument (5th of importKey) to a bitmask of the
 * enum's indices, or raises the WebIDL error (returns false). */
static bool scr_wc_usages_convert(const ScrDyn *usages, unsigned *mask, ScrDyn **rej) {
  *mask = 0;
  if (!scr_wc_is_arr(usages)) {
    *rej = scr_wc_reject_later(WC_ERR_TYPE, "ERR_INVALID_ARG_TYPE",
                               "Failed to execute 'importKey' on 'SubtleCrypto': 5th argument can not be converted to sequence.");
    return false;
  }
  double n = scr_dyn_arr_len(usages);
  for (double i = 0; i < n; i++) {
    ScrDyn *u = scr_dyn_arr_at(usages, i); /* +1 */
    ScrStr *s = scr_dyn_string_coerce(u);  /* +1 */
    int idx = scr_wc_usage_index(s);
    if (idx < 0) {
      char buf[512];
      snprintf(buf, sizeof buf,
               "Failed to execute 'importKey' on 'SubtleCrypto': 5th argument[%.0f] value '%.*s' is not a valid enum value of type KeyUsage.",
               i, (int)s->len, s->data);
      *rej = scr_wc_reject_later(WC_ERR_TYPE, "ERR_INVALID_ARG_VALUE", buf);
      scr_str_release(s);
      scr_dyn_release(u);
      return false;
    }
    *mask |= 1u << idx;
    scr_str_release(s);
    scr_dyn_release(u);
  }
  return true;
}

static bool scr_wc_mask_only(unsigned mask, unsigned allowed) {
  return (mask & ~allowed) == 0;
}

static unsigned scr_wc_idx_bit(const char *name) {
  for (int i = 0; i < 12; i++) if (strcmp(WC_USAGES[i], name) == 0) return 1u << i;
  return 0;
}

/* The key's usages as the caller gave them (the enum names, in order). */
static ScrDyn *scr_wc_usage_arr(const ScrDyn *usages) {
  ScrDyn *arr = scr_dyn_new_arr();
  double n = scr_dyn_arr_len(usages);
  for (double i = 0; i < n; i++) {
    ScrDyn *u = scr_dyn_arr_at(usages, i);
    scr_dyn_arr_push(arr, u);
  }
  return arr;
}

/* A fresh CryptoKey. Its four members are NON-ENUMERABLE (Node keeps them on
 * the prototype: Object.keys, for-in, JSON and spread see none), and the
 * inspect hook renders them. */
static ScrDyn *scr_wc_key_new(int kind, WcHash hash, const unsigned char *kp, size_t kn, bool extractable,
                              const ScrDyn *usages) {
  ScrDyn *obj = scr_dyn_new_obj();
  scr_dyn_obj_set_ctor_name(obj, scr_wc_key_cname);
  scr_wc_tag(obj, "CryptoKey");
  ScrDyn *alg = scr_dyn_new_obj();
  scr_dyn_obj_set(alg, "name", 4, scr_wc_str(kind == WC_KEY_HMAC ? "HMAC" : "PBKDF2", kind == WC_KEY_HMAC ? 4 : 6));
  if (kind == WC_KEY_HMAC) {
    scr_dyn_obj_set(alg, "length", 6, scr_dyn_new_num((double)kn * 8));
    ScrDyn *hobj = scr_dyn_new_obj();
    scr_dyn_obj_set(hobj, "name", 4, scr_wc_str(scr_wc_hash_name(hash), strlen(scr_wc_hash_name(hash))));
    scr_dyn_obj_set(alg, "hash", 4, hobj);
  }
  ScrDyn *type = scr_wc_str("secret", 6);
  ScrDyn *ext = scr_dyn_new_bool(extractable);
  ScrDyn *usg = scr_wc_usage_arr(usages);
  /* hidden for the property protocol (define retains), slotted for the inspect hook (the slot takes ownership) */
  scr_dyn_obj_define_hidden_data(obj, "type", 4, type, false, true);
  scr_dyn_obj_define_hidden_data(obj, "extractable", 11, ext, false, true);
  scr_dyn_obj_define_hidden_data(obj, "algorithm", 9, alg, false, true);
  scr_dyn_obj_define_hidden_data(obj, "usages", 6, usg, false, true);
  scr_dyn_obj_set_slot(obj, "%type", 5, type);
  scr_dyn_obj_set_slot(obj, "%extractable", 12, ext);
  scr_dyn_obj_set_slot(obj, "%algorithm", 10, alg);
  scr_dyn_obj_set_slot(obj, "%usages", 7, usg);
  scr_dyn_obj_set_slot(obj, "%kind", 5, scr_dyn_new_num((double)kind));
  scr_dyn_obj_set_slot(obj, "%hash", 5, scr_dyn_new_num((double)hash));
  ScrBytes *kb = scr_bytes_new(SCR_BYTES_U8, (double)kn);
  if (kn > 0) memcpy(kb->data, kp, kn);
  scr_dyn_obj_set_slot(obj, "%key", 4, scr_dyn_new_bytes_ref(kb));
  scr_bytes_release(kb);
  return obj;
}

/* A fulfilled ArrayBuffer payload from `n` bytes of `d`. +1. */
static ScrDyn *scr_wc_arrbuf(const unsigned char *d, size_t n) {
  ScrBytes *out = scr_bytes_new(SCR_BYTES_BUF, (double)n);
  if (n > 0) memcpy(out->data, d, n);
  ScrDyn *ab = scr_dyn_new_arrbuf_ref(out); /* +1 */
  scr_bytes_release(out);
  return ab;
}

/* The algorithm name for digest: a string, or a dictionary with `name`.
 * Returns +1 (a ScrStr), or NULL with *missing set for a dictionary without
 * one (Node's TypeError). */
static ScrStr *scr_wc_alg_name(const ScrDyn *alg, bool *missing) {
  *missing = false;
  if (alg != NULL && (alg->kind == SCR_DYN_OBJ || alg->kind == SCR_DYN_ARR)) {
    const ScrDyn *n = alg->kind == SCR_DYN_OBJ ? scr_dyn_obj_get(alg, "name", 4) : NULL;
    if (n == NULL || n->kind == SCR_DYN_UNDEF) { *missing = true; return NULL; }
    return scr_dyn_string_coerce(n);
  }
  return scr_dyn_string_coerce(alg);
}

/* ── the SubtleCrypto members ──────────────────────────────────────────── */

/* digest(algorithm, data): data is converted first (WebIDL), then the name. */
static ScrDyn *scr_wc_subtle_digest(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (argc < 2) return scr_wc_reject_args("digest", 2, argc);
  const unsigned char *dp = NULL;
  size_t dn = 0;
  if (!scr_wc_bytes_of(args[1], &dp, &dn)) return scr_wc_reject_data("digest", "2nd");
  bool missing = false;
  ScrStr *name = scr_wc_alg_name(args[0], &missing);
  if (missing) {
    return scr_wc_reject_later(WC_ERR_TYPE, "ERR_MISSING_OPTION",
                               "Failed to normalize algorithm: passed algorithm can not be converted to 'Algorithm' because 'name' is required in 'Algorithm'.");
  }
  WcHash h = WC_SHA256;
  bool ok = name != NULL && scr_wc_hash_name_of(name, &h);
  if (name != NULL) scr_str_release(name);
  if (ok) scr_wc_warn_sha3(h);
  if (!ok) return scr_wc_reject_later(WC_ERR_DOM, "NotSupportedError", "Unrecognized algorithm name");
  unsigned char d[64];
  size_t n = wc_hash(h, dp, dn, d);
  ScrDyn *ab = scr_wc_arrbuf(d, n);
  ScrDyn *p = scr_wc_resolve_later(ab);
  scr_dyn_release(ab);
  return p;
}

/* importKey(format, keyData, algorithm, extractable, usages): 'raw' HMAC and
 * PBKDF2 keys. The compiler proves the format and the algorithm; the
 * checks here are Node's, in Node's order. */
static ScrDyn *scr_wc_subtle_import_key(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (argc < 5) return scr_wc_reject_args("importKey", 5, argc);
  const ScrDyn *fmt = args[0];
  if (fmt == NULL || fmt->kind != SCR_DYN_STR || fmt->v.str->len != 3 || memcmp(fmt->v.str->data, "raw", 3) != 0) {
    return scr_wc_reject_later(WC_ERR_TYPE, "ERR_INVALID_ARG_VALUE",
                               "Failed to execute 'importKey' on 'SubtleCrypto': 1st argument is not a supported key format.");
  }
  const unsigned char *kp = NULL;
  size_t kn = 0;
  if (!scr_wc_bytes_of(args[1], &kp, &kn)) return scr_wc_reject_data("importKey", "2nd");
  unsigned umask = 0;
  ScrDyn *rej = NULL;
  if (!scr_wc_usages_convert(args[4], &umask, &rej)) return rej;
  bool extractable = scr_dyn_truthy(args[3]);
  const ScrDyn *alg = args[2];
  bool is_hmac = false;
  bool is_pbkdf2 = false;
  bool missing = false;
  ScrStr *an = scr_wc_alg_name(alg, &missing);
  if (missing) {
    return scr_wc_reject_later(WC_ERR_TYPE, "ERR_MISSING_OPTION",
                               "Failed to normalize algorithm: passed algorithm can not be converted to 'Algorithm' because 'name' is required in 'Algorithm'.");
  }
  if (an == NULL) return scr_wc_reject_later(WC_ERR_DOM, "NotSupportedError", "Unrecognized algorithm name");
  is_hmac = scr_wc_ieq(an, "HMAC");
  is_pbkdf2 = !is_hmac && scr_wc_ieq(an, "PBKDF2");
  scr_str_release(an);
  if (!is_hmac && !is_pbkdf2) return scr_wc_reject_later(WC_ERR_DOM, "NotSupportedError", "Unrecognized algorithm name");
  WcHash h = WC_SHA256;
  double hmac_length = 0; /* the HmacImportParams.length member, 0 when absent */
  if (is_hmac) {
    const ScrDyn *hd = alg->kind == SCR_DYN_OBJ ? scr_dyn_obj_get(alg, "hash", 4) : NULL;
    if (hd == NULL) {
      return scr_wc_reject_later(WC_ERR_TYPE, "ERR_MISSING_OPTION",
                                 "Failed to normalize algorithm: passed algorithm can not be converted to 'HmacImportParams' because 'hash' is required in 'HmacImportParams'.");
    }
    ScrStr *hn = scr_wc_alg_name(hd, &missing);
    bool okh = hn != NULL && scr_wc_hash_name_of(hn, &h);
    if (hn != NULL) scr_str_release(hn);
    if (okh) scr_wc_warn_sha3(h);
    if (!okh) return scr_wc_reject_later(WC_ERR_DOM, "NotSupportedError", "Only SHA hashes are supported in HmacImportParams");
    /* HmacImportParams.length (measured against Node): the conversion, then zero, then a
     * multiple of 8; usage; a zero key; a mismatch with the key's bits; then empty usages. */
    const ScrDyn *ld = scr_dyn_obj_get(alg, "length", 6);
    if (ld != NULL && ld->kind != SCR_DYN_UNDEF) {
      double lv = ld->kind == SCR_DYN_NULL ? 0 : scr_dyn_to_number(ld);
      if (lv != lv || lv == INFINITY || lv == -INFINITY) {
        return scr_wc_reject_later(WC_ERR_TYPE, "ERR_INVALID_ARG_TYPE",
                                   "Failed to normalize algorithm: 'length' of 'HmacImportParams' (passed algorithm) is not a finite number.");
      }
      double lt = lv < 0 ? -floor(-lv) : floor(lv);
      if (lt < 0 || lt > 4294967295.0) {
        return scr_wc_reject_later(WC_ERR_TYPE, "ERR_OUT_OF_RANGE",
                                   "Failed to normalize algorithm: 'length' of 'HmacImportParams' (passed algorithm) is outside the expected range of 0 to 4294967295.");
      }
      if (lt == 0) return scr_wc_reject_later(WC_ERR_DOM, "DataError", "HmacImportParams.length cannot be 0");
      if (fmod(lt, 8.0) != 0) return scr_wc_reject_later(WC_ERR_DOM, "NotSupportedError", "Unsupported HmacImportParams.length");
      hmac_length = lt;
    }
  }
  if (is_pbkdf2) {
    if (extractable) return scr_wc_reject_later(WC_ERR_DOM, "SyntaxError", "PBKDF2 keys are not extractable");
    if (!scr_wc_mask_only(umask, scr_wc_idx_bit("deriveKey") | scr_wc_idx_bit("deriveBits"))) {
      return scr_wc_reject_later(WC_ERR_DOM, "SyntaxError", "Unsupported key usage for a PBKDF2 key");
    }
  } else {
    if (!scr_wc_mask_only(umask, scr_wc_idx_bit("sign") | scr_wc_idx_bit("verify"))) {
      return scr_wc_reject_later(WC_ERR_DOM, "SyntaxError", "Unsupported key usage for HMAC key");
    }
    if (kn == 0) return scr_wc_reject_later(WC_ERR_DOM, "DataError", "Zero-length key is not supported");
    if (hmac_length > 0 && hmac_length != (double)kn * 8) return scr_wc_reject_later(WC_ERR_DOM, "DataError", "Invalid key length");
  }
  if (scr_dyn_arr_len(args[4]) == 0) {
    return scr_wc_reject_later(WC_ERR_DOM, "SyntaxError", "Usages cannot be empty when importing a secret key.");
  }
  ScrDyn *k = scr_wc_key_new(is_hmac ? WC_KEY_HMAC : WC_KEY_PBKDF2, h, kp, kn, extractable, args[4]);
  ScrDyn *p = scr_wc_resolve_later(k);
  scr_dyn_release(k);
  return p;
}

/* sign(algorithm, key, data): HMAC. */
static ScrDyn *scr_wc_subtle_sign(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (argc < 3) return scr_wc_reject_args("sign", 3, argc);
  int kind = -1;
  if (!scr_wc_is_key(args[1], &kind)) return scr_wc_reject_key("sign");
  const unsigned char *dp = NULL;
  size_t dn = 0;
  if (!scr_wc_bytes_of(args[2], &dp, &dn)) return scr_wc_reject_data("sign", "3rd");
  const ScrDyn *hs = scr_dyn_obj_slot_get(args[1], "%hash", 5);
  const ScrDyn *ks = scr_dyn_obj_slot_get(args[1], "%key", 4);
  const ScrDyn *us = scr_dyn_obj_slot_get(args[1], "%usages", 7);
  unsigned umask = 0;
  if (us != NULL) {
    double n = scr_dyn_arr_len(us);
    for (double i = 0; i < n; i++) {
      ScrDyn *u = scr_dyn_arr_at(us, i);
      if (u != NULL && u->kind == SCR_DYN_STR) {
        int idx = scr_wc_usage_index(u->v.str);
        if (idx >= 0) umask |= 1u << idx;
      }
      scr_dyn_release(u);
    }
  }
  if (kind != WC_KEY_HMAC || !(umask & scr_wc_idx_bit("sign"))) {
    return scr_wc_reject_later(WC_ERR_DOM, "InvalidAccessError", "Unable to use this key to sign");
  }
  WcHash h = (WcHash)(int)hs->v.num;
  const unsigned char *kp = NULL;
  size_t kn = 0;
  scr_wc_bytes_of(ks, &kp, &kn);
  unsigned char mac[64];
  size_t mn = wc_hmac(h, kp, kn, dp, dn, mac);
  ScrDyn *ab = scr_wc_arrbuf(mac, mn);
  ScrDyn *p = scr_wc_resolve_later(ab);
  scr_dyn_release(ab);
  return p;
}

/* deriveBits(algorithm, baseKey, length): PBKDF2. The order: the key (WebIDL),
 * the length conversion, the Pbkdf2Params dictionary (hash, iterations, salt),
 * iterations zero, the usage, a null length, a negative length, and the
 * multiple of 8. */
static ScrDyn *scr_wc_subtle_derive_bits(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (argc < 2) return scr_wc_reject_args("deriveBits", 2, argc);
  int kind = -1;
  if (!scr_wc_is_key(args[1], &kind)) return scr_wc_reject_key("deriveBits");
  bool have_len = argc >= 3 && args[2] != NULL && args[2]->kind != SCR_DYN_NULL && args[2]->kind != SCR_DYN_UNDEF;
  double lenv = have_len ? scr_dyn_to_number(args[2]) : 0;
  const ScrDyn *alg = args[0];
  bool obj = alg != NULL && alg->kind == SCR_DYN_OBJ;
  /* Pbkdf2Params, members in alphabetical order: hash, iterations, salt. */
  const ScrDyn *hd = obj ? scr_dyn_obj_get(alg, "hash", 4) : NULL;
  if (hd == NULL) {
    return scr_wc_reject_later(WC_ERR_TYPE, "ERR_MISSING_OPTION",
                               "Failed to normalize algorithm: passed algorithm can not be converted to 'Pbkdf2Params' because 'hash' is required in 'Pbkdf2Params'.");
  }
  bool missing = false;
  ScrStr *hn = scr_wc_alg_name(hd, &missing);
  WcHash h = WC_SHA256;
  bool okh = hn != NULL && scr_wc_hash_name_of(hn, &h);
  if (hn != NULL) scr_str_release(hn);
  if (okh) scr_wc_warn_sha3(h);
  if (!okh) return scr_wc_reject_later(WC_ERR_DOM, "NotSupportedError", "Only SHA hashes are supported in Pbkdf2Params");
  const ScrDyn *itd = obj ? scr_dyn_obj_get(alg, "iterations", 10) : NULL;
  if (itd == NULL) {
    return scr_wc_reject_later(WC_ERR_TYPE, "ERR_MISSING_OPTION",
                               "Failed to normalize algorithm: passed algorithm can not be converted to 'Pbkdf2Params' because 'iterations' is required in 'Pbkdf2Params'.");
  }
  double itv = scr_dyn_to_number(itd);
  if (itv != itv || itv == INFINITY || itv == -INFINITY) {
    return scr_wc_reject_later(WC_ERR_TYPE, "ERR_INVALID_ARG_TYPE",
                               "Failed to normalize algorithm: 'iterations' of 'Pbkdf2Params' (passed algorithm) is not a finite number.");
  }
  double itt = itv < 0 ? -floor(-itv) : floor(itv);
  if (itt < 0 || itt > 4294967295.0) {
    return scr_wc_reject_later(WC_ERR_TYPE, "ERR_OUT_OF_RANGE",
                               "Failed to normalize algorithm: 'iterations' of 'Pbkdf2Params' (passed algorithm) is outside the expected range of 0 to 4294967295.");
  }
  const ScrDyn *sd = obj ? scr_dyn_obj_get(alg, "salt", 4) : NULL;
  if (sd == NULL) {
    return scr_wc_reject_later(WC_ERR_TYPE, "ERR_MISSING_OPTION",
                               "Failed to normalize algorithm: passed algorithm can not be converted to 'Pbkdf2Params' because 'salt' is required in 'Pbkdf2Params'.");
  }
  const unsigned char *sp = NULL;
  size_t sn = 0;
  if (!scr_wc_bytes_of(sd, &sp, &sn)) {
    return scr_wc_reject_later(WC_ERR_TYPE, "ERR_INVALID_ARG_TYPE",
                               "Failed to normalize algorithm: 'salt' of 'Pbkdf2Params' (passed algorithm) is not instance of ArrayBuffer, Buffer, TypedArray, or DataView.");
  }
  if (itt == 0) return scr_wc_reject_later(WC_ERR_DOM, "OperationError", "iterations cannot be zero");
  const ScrDyn *ks = scr_dyn_obj_slot_get(args[1], "%key", 4);
  const ScrDyn *us = scr_dyn_obj_slot_get(args[1], "%usages", 7);
  unsigned umask = 0;
  if (us != NULL) {
    double n = scr_dyn_arr_len(us);
    for (double i = 0; i < n; i++) {
      ScrDyn *u = scr_dyn_arr_at(us, i);
      if (u != NULL && u->kind == SCR_DYN_STR) {
        int idx = scr_wc_usage_index(u->v.str);
        if (idx >= 0) umask |= 1u << idx;
      }
      scr_dyn_release(u);
    }
  }
  if (kind != WC_KEY_PBKDF2 || !(umask & scr_wc_idx_bit("deriveBits"))) {
    return scr_wc_reject_later(WC_ERR_DOM, "InvalidAccessError", "baseKey does not have deriveBits usage");
  }
  if (!have_len) return scr_wc_reject_later(WC_ERR_DOM, "OperationError", "length cannot be null");
  if (lenv != lenv || lenv == INFINITY || lenv == -INFINITY) lenv = 0;
  if (lenv < 0) {
    return scr_wc_reject_later(WC_ERR_DOM, "OperationError", "The operation failed for an operation-specific reason");
  }
  double bits = fmod(floor(lenv), 4294967296.0);
  if (fmod(bits, 8.0) != 0) return scr_wc_reject_later(WC_ERR_DOM, "OperationError", "length must be a multiple of 8");
  const unsigned char *kp = NULL;
  size_t kn = 0;
  scr_wc_bytes_of(ks, &kp, &kn);
  size_t want = (size_t)(bits / 8.0);
  unsigned char *derived = wc_pbkdf2(h, kp, kn, sp, sn, (unsigned long)itt, want);
  ScrDyn *ab = scr_wc_arrbuf(derived, want);
  free(derived);
  ScrDyn *p = scr_wc_resolve_later(ab);
  scr_dyn_release(ab);
  return p;
}

static ScrDyn *scr_wc_subtle_get(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  (void)args;
  (void)argc;
  return scr_dyn_retain(scr_wc_subtle_obj);
}

/* "[object Tag]" for an OBJ whose well-known toStringTag member is a string
 * (own enumerable, or hidden as a converted record's symbol member), else NULL.
 * Object.prototype.toString's rule for the WebCrypto objects (scr_json.c asks). */
static ScrStr *scr_wc_obj_tag(const ScrDyn *d) {
  for (int pass = 0; pass < 2; pass++) {
    const ScrDyn *src = d;
    if (pass == 1) {
      if (scr_dyn_ext(d)->hidden == NULL) break;
      src = scr_dyn_ext(d)->hidden;
    }
    for (size_t i = 0; i < src->v.obj.len; i++) {
      const ScrDynEntry *e = &src->v.obj.entries[i];
      const ScrDyn *val = e->value;
      if (pass == 1) {
        if (val->kind != SCR_DYN_ARR || val->v.arr.len < 2) continue;
        val = val->v.arr.items[1];
      }
      if (e->key_len > 15 && memcmp(e->key, "__@toStringTag@", 15) == 0 && val->kind == SCR_DYN_STR) {
        const ScrStr *t = val->v.str;
        ScrStr *out = scr_str_alloc_raw(t->len + 9, t->len + 9);
        memcpy(out->data, "[object ", 8);
        memcpy(out->data + 8, t->data, t->len);
        out->data[8 + t->len] = ']';
        out->len = (uint32_t)(t->len + 9);
        out->data[out->len] = '\0';
        return out;
      }
    }
  }
  return NULL;
}

/* A CryptoKey prints through Node's CryptoKey inspect hook: `CryptoKey ` followed
 * by an inspection of its four members at the remaining depth less one. NULL for
 * every other object (scr_inspect.c keeps the ordinary rule for those). */
static ScrStr *scr_wc_insp_hook(ScrDyn *d, const char *cn, double recurse, double depth) {
  if (cn != scr_wc_key_cname) return NULL;
  if (recurse > depth) return scr_str_new("[CryptoKey]", 11);
  ScrDyn *tmp = scr_dyn_new_obj();
  static const char *const kmembers[4] = {"type", "extractable", "algorithm", "usages"};
  static const char *const kslots[4] = {"%type", "%extractable", "%algorithm", "%usages"};
  for (int k = 0; k < 4; k++) {
    const ScrDyn *mv = scr_dyn_obj_slot_get(d, kslots[k], strlen(kslots[k]));
    if (mv != NULL) scr_dyn_obj_set(tmp, kmembers[k], strlen(kmembers[k]), scr_dyn_retain((ScrDyn *)mv));
  }
  ScrStr *inner = scr_insp_dyn(tmp, 0, depth - 1); /* Node: the top-level depth less one */
  scr_dyn_release(tmp);
  size_t n = 10 + inner->len;
  ScrStr *out = scr_str_alloc_raw(n, n);
  memcpy(out->data, "CryptoKey ", 10);
  memcpy(out->data + 10, inner->data, inner->len);
  out->len = (uint32_t)n;
  out->data[n] = '\0';
  scr_str_release(inner);
  return out;
}

ScrDyn *scr_dyn_web_crypto(void) {
  if (scr_wc_obj == NULL) {
    scr_dyn_obj_tag_hook = scr_wc_obj_tag;
    scr_insp_hook = scr_wc_insp_hook;
    ScrDyn *o = scr_dyn_new_obj(); /* +1, the singleton's own reference */
    scr_dyn_obj_set_ctor_name(o, "Crypto");
    scr_wc_tag(o, "Crypto");
    scr_wc_define_method(o, "getRandomValues", scr_wc_get_random_values, 1);
    scr_wc_define_method(o, "randomUUID", scr_wc_random_uuid, 0);
    scr_wc_define_getter(o, "subtle", scr_wc_subtle_get);
    scr_wc_obj = o;
    ScrDyn *s = scr_dyn_new_obj();
    scr_dyn_obj_set_ctor_name(s, "SubtleCrypto");
    scr_wc_tag(s, "SubtleCrypto");
    scr_wc_define_method(s, "digest", scr_wc_subtle_digest, 2);
    scr_wc_define_method(s, "importKey", scr_wc_subtle_import_key, 5);
    scr_wc_define_method(s, "sign", scr_wc_subtle_sign, 3);
    scr_wc_define_method(s, "deriveBits", scr_wc_subtle_derive_bits, 2);
    scr_wc_subtle_obj = s;
    scr_atexit(scr_wc_teardown);
  }
  return scr_dyn_retain(scr_wc_obj);
}
