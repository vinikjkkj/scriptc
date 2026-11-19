// Included twice by monocypher-x25519-64.h: once as X4SFX=plain and once as X4SFX=bmi2 (X4TGT carries target("bmi2")). scriptc, see there.
#define X4_(n, sfx) x4_##n##_##sfx
#define X4__(n, sfx) X4_(n, sfx)
#define X4(n) X4__(n, X4SFX)
static inline X4TGT void X4(add)(x4fe *h, const x4fe *f, const x4fe *g) {
  x4u128 c = (x4u128)f->v[0] + g->v[0]; uint64_t a0 = (uint64_t)c; c >>= 64;
  c += (x4u128)f->v[1] + g->v[1]; uint64_t a1 = (uint64_t)c; c >>= 64;
  c += (x4u128)f->v[2] + g->v[2]; uint64_t a2 = (uint64_t)c; c >>= 64;
  c += (x4u128)f->v[3] + g->v[3]; uint64_t a3 = (uint64_t)c; uint64_t k = (uint64_t)(c >> 64);
  c = (x4u128)a0 + 38 * k; a0 = (uint64_t)c; c >>= 64;
  c += a1; a1 = (uint64_t)c; c >>= 64;
  c += a2; a2 = (uint64_t)c; c >>= 64;
  c += a3; a3 = (uint64_t)c; k = (uint64_t)(c >> 64);
  a0 += 38 * k;
  h->v[0] = a0; h->v[1] = a1; h->v[2] = a2; h->v[3] = a3;
}
static inline X4TGT void X4(sub)(x4fe *h, const x4fe *f, const x4fe *g) {
  x4u128 c = (x4u128)f->v[0] - g->v[0]; uint64_t a0 = (uint64_t)c; uint64_t b = (uint64_t)(c >> 64) & 1;
  uint64_t fl = f->v[1], gl = g->v[1]; uint64_t a1 = fl - gl - b; b = ((~fl & gl) | (~(fl ^ gl) & a1)) >> 63;
  fl = f->v[2]; gl = g->v[2]; uint64_t a2 = fl - gl - b; b = ((~fl & gl) | (~(fl ^ gl) & a2)) >> 63;
  fl = f->v[3]; gl = g->v[3]; uint64_t a3 = fl - gl - b; b = ((~fl & gl) | (~(fl ^ gl) & a3)) >> 63;
  /* b = final borrow: value is f-g+2^256 when b==1, which is congruent to f-g+38 */
  uint64_t s = 38 * b;
  uint64_t t0 = a0 - s; uint64_t b2 = a0 < s;
  uint64_t t1 = a1 - b2; b2 = a1 < b2;
  uint64_t t2 = a2 - b2; b2 = a2 < b2;
  uint64_t t3 = a3 - b2; b2 = a3 < b2;
  t0 -= 38 * b2;
  h->v[0] = t0; h->v[1] = t1; h->v[2] = t2; h->v[3] = t3;
}
static inline X4TGT void X4(reduce8)(x4fe *h, const uint64_t t[8]) {
  x4u128 c = (x4u128)t[4] * 38 + t[0]; uint64_t a0 = (uint64_t)c; c >>= 64;
  c += (x4u128)t[5] * 38 + t[1]; uint64_t a1 = (uint64_t)c; c >>= 64;
  c += (x4u128)t[6] * 38 + t[2]; uint64_t a2 = (uint64_t)c; c >>= 64;
  c += (x4u128)t[7] * 38 + t[3]; uint64_t a3 = (uint64_t)c; uint64_t k = (uint64_t)(c >> 64); /* k < 39 */
  c = (x4u128)a0 + 38 * k; a0 = (uint64_t)c; c >>= 64;
  c += a1; a1 = (uint64_t)c; c >>= 64;
  c += a2; a2 = (uint64_t)c; c >>= 64;
  c += a3; a3 = (uint64_t)c; k = (uint64_t)(c >> 64);
  a0 += 38 * k;
  h->v[0] = a0; h->v[1] = a1; h->v[2] = a2; h->v[3] = a3;
}
static X4NOINLINE X4TGT void X4(mul)(x4fe *h, const x4fe *f, const x4fe *g) {
  uint64_t t[8];
  uint64_t f0 = f->v[0], f1 = f->v[1], f2 = f->v[2], f3 = f->v[3];
  uint64_t g0 = g->v[0], g1 = g->v[1], g2 = g->v[2], g3 = g->v[3];
  x4u128 p; uint64_t c;
  p = (x4u128)f0 * g0; t[0] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f0 * g1 + c; t[1] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f0 * g2 + c; t[2] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f0 * g3 + c; t[3] = (uint64_t)p; t[4] = (uint64_t)(p >> 64);
  p = (x4u128)f1 * g0 + t[1]; t[1] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f1 * g1 + t[2] + c; t[2] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f1 * g2 + t[3] + c; t[3] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f1 * g3 + t[4] + c; t[4] = (uint64_t)p; t[5] = (uint64_t)(p >> 64);
  p = (x4u128)f2 * g0 + t[2]; t[2] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f2 * g1 + t[3] + c; t[3] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f2 * g2 + t[4] + c; t[4] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f2 * g3 + t[5] + c; t[5] = (uint64_t)p; t[6] = (uint64_t)(p >> 64);
  p = (x4u128)f3 * g0 + t[3]; t[3] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f3 * g1 + t[4] + c; t[4] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f3 * g2 + t[5] + c; t[5] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f3 * g3 + t[6] + c; t[6] = (uint64_t)p; t[7] = (uint64_t)(p >> 64);
  X4(reduce8)(h, t);
}
static X4NOINLINE X4TGT void X4(sq)(x4fe *h, const x4fe *f) {
  uint64_t t[8]; uint64_t f0 = f->v[0], f1 = f->v[1], f2 = f->v[2], f3 = f->v[3];
  x4u128 p; uint64_t c;
  /* off-diagonal products f_i*f_j, i<j, into t[1..6] */
  p = (x4u128)f0 * f1; t[1] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f0 * f2 + c; t[2] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f0 * f3 + c; t[3] = (uint64_t)p; t[4] = (uint64_t)(p >> 64);
  p = (x4u128)f1 * f2 + t[3]; t[3] = (uint64_t)p; c = (uint64_t)(p >> 64);
  p = (x4u128)f1 * f3 + t[4] + c; t[4] = (uint64_t)p; t[5] = (uint64_t)(p >> 64);
  p = (x4u128)f2 * f3 + t[5]; t[5] = (uint64_t)p; t[6] = (uint64_t)(p >> 64);
  /* double */
  t[7] = t[6] >> 63; t[6] = (t[6] << 1) | (t[5] >> 63); t[5] = (t[5] << 1) | (t[4] >> 63);
  t[4] = (t[4] << 1) | (t[3] >> 63); t[3] = (t[3] << 1) | (t[2] >> 63); t[2] = (t[2] << 1) | (t[1] >> 63);
  t[1] <<= 1; t[0] = 0;
  /* add squares f_i^2 at 2i */
  p = (x4u128)f0 * f0; t[0] = (uint64_t)p; x4u128 a = (x4u128)t[1] + (uint64_t)(p >> 64); t[1] = (uint64_t)a; c = (uint64_t)(a >> 64);
  p = (x4u128)f1 * f1; a = (x4u128)t[2] + (uint64_t)p + c; t[2] = (uint64_t)a; c = (uint64_t)(a >> 64);
  a = (x4u128)t[3] + (uint64_t)(p >> 64) + c; t[3] = (uint64_t)a; c = (uint64_t)(a >> 64);
  p = (x4u128)f2 * f2; a = (x4u128)t[4] + (uint64_t)p + c; t[4] = (uint64_t)a; c = (uint64_t)(a >> 64);
  a = (x4u128)t[5] + (uint64_t)(p >> 64) + c; t[5] = (uint64_t)a; c = (uint64_t)(a >> 64);
  p = (x4u128)f3 * f3; a = (x4u128)t[6] + (uint64_t)p + c; t[6] = (uint64_t)a; c = (uint64_t)(a >> 64);
  t[7] = t[7] + (uint64_t)(p >> 64) + c;
  X4(reduce8)(h, t);
}
static inline X4TGT void X4(mul_small)(x4fe *h, const x4fe *f, uint64_t k) {
  x4u128 c = (x4u128)f->v[0] * k; uint64_t a0 = (uint64_t)c; c >>= 64;
  c += (x4u128)f->v[1] * k; uint64_t a1 = (uint64_t)c; c >>= 64;
  c += (x4u128)f->v[2] * k; uint64_t a2 = (uint64_t)c; c >>= 64;
  c += (x4u128)f->v[3] * k; uint64_t a3 = (uint64_t)c; uint64_t hi = (uint64_t)(c >> 64);
  c = (x4u128)a0 + (x4u128)hi * 38; a0 = (uint64_t)c; c >>= 64;
  c += a1; a1 = (uint64_t)c; c >>= 64;
  c += a2; a2 = (uint64_t)c; c >>= 64;
  c += a3; a3 = (uint64_t)c; uint64_t kk = (uint64_t)(c >> 64);
  a0 += 38 * kk;
  h->v[0] = a0; h->v[1] = a1; h->v[2] = a2; h->v[3] = a3;
}
static inline X4TGT void X4(cswap)(x4fe *a, x4fe *b, uint64_t swap) {
  uint64_t m = (uint64_t)0 - swap;
  for (int i = 0; i < 4; i++) { uint64_t t = m & (a->v[i] ^ b->v[i]); a->v[i] ^= t; b->v[i] ^= t; }
}
static X4NOINLINE X4TGT void X4(sqn)(x4fe *h, const x4fe *f, int n) { X4(sq)(h, f); for (int i = 1; i < n; i++) X4(sq)(h, h); }
static X4NOINLINE X4TGT void X4(invert)(x4fe *out, const x4fe *z) {
  x4fe t0, t1, t2, t3;
  X4(sq)(&t0, z);                       /* 2 */
  X4(sqn)(&t1, &t0, 2); X4(mul)(&t1, z, &t1);        /* 9 */
  X4(mul)(&t0, &t0, &t1);               /* 11 */
  X4(sq)(&t2, &t0); X4(mul)(&t1, &t1, &t2);          /* 2^5-1 */
  X4(sqn)(&t2, &t1, 5); X4(mul)(&t1, &t2, &t1);      /* 2^10-1 */
  X4(sqn)(&t2, &t1, 10); X4(mul)(&t2, &t2, &t1);     /* 2^20-1 */
  X4(sqn)(&t3, &t2, 20); X4(mul)(&t2, &t3, &t2);     /* 2^40-1 */
  X4(sqn)(&t2, &t2, 10); X4(mul)(&t1, &t2, &t1);     /* 2^50-1 */
  X4(sqn)(&t2, &t1, 50); X4(mul)(&t2, &t2, &t1);     /* 2^100-1 */
  X4(sqn)(&t3, &t2, 100); X4(mul)(&t2, &t3, &t2);    /* 2^200-1 */
  X4(sqn)(&t2, &t2, 50); X4(mul)(&t1, &t2, &t1);     /* 2^250-1 */
  X4(sqn)(&t1, &t1, 5); X4(mul)(out, &t1, &t0);      /* 2^255-21 */
}
static X4TGT void X4(frombytes)(x4fe *h, const uint8_t s[32]) {
  for (int i = 0; i < 4; i++) { uint64_t w = 0; for (int j = 7; j >= 0; j--) w = (w << 8) | s[8 * i + j]; h->v[i] = w; }
  h->v[3] &= 0x7fffffffffffffffULL;
}
static X4NOINLINE X4TGT void X4(tobytes)(uint8_t s[32], const x4fe *f) {
  uint64_t a0 = f->v[0], a1 = f->v[1], a2 = f->v[2], a3 = f->v[3];
  uint64_t top = a3 >> 63; a3 &= 0x7fffffffffffffffULL;
  x4u128 c = (x4u128)a0 + 19 * top; a0 = (uint64_t)c; c >>= 64;
  c += a1; a1 = (uint64_t)c; c >>= 64; c += a2; a2 = (uint64_t)c; c >>= 64; c += a3; a3 = (uint64_t)c;   /* < 2^255+19 */
  c = (x4u128)a0 + 19; uint64_t b0 = (uint64_t)c; c >>= 64;
  c += a1; uint64_t b1 = (uint64_t)c; c >>= 64; c += a2; uint64_t b2 = (uint64_t)c; c >>= 64; c += a3; uint64_t b3 = (uint64_t)c;
  uint64_t q = b3 >> 63;        /* h + 19 >= 2^255  <=>  h >= p */
  uint64_t m = (uint64_t)0 - q;
  a0 = (a0 & ~m) | (b0 & m); a1 = (a1 & ~m) | (b1 & m); a2 = (a2 & ~m) | (b2 & m); a3 = (a3 & ~m) | (b3 & m);
  a3 &= 0x7fffffffffffffffULL;
  uint64_t w[4] = { a0, a1, a2, a3 };
  for (int i = 0; i < 4; i++) for (int j = 0; j < 8; j++) s[8 * i + j] = (uint8_t)(w[i] >> (8 * j));
}
static X4NOINLINE X4TGT void X4(ladder)(uint8_t q[32], const uint8_t scalar_in[32], const uint8_t p[32]) {
  uint8_t e[32]; memcpy(e, scalar_in, 32); e[0] &= 248; e[31] &= 127; e[31] |= 64;
  x4fe x1, x2, z2, x3, z3, t0, t1;
  X4(frombytes)(&x1, p);
  memset(&x2, 0, sizeof x2); x2.v[0] = 1; memset(&z2, 0, sizeof z2);
  x3 = x1; memset(&z3, 0, sizeof z3); z3.v[0] = 1;
  uint64_t swap = 0;
  for (int pos = 254; pos >= 0; --pos) {
    uint64_t b = (e[pos >> 3] >> (pos & 7)) & 1;
    swap ^= b; X4(cswap)(&x2, &x3, swap); X4(cswap)(&z2, &z3, swap); swap = b;
    X4(sub)(&t0, &x3, &z3);
    X4(sub)(&t1, &x2, &z2);
    X4(add)(&x2, &x2, &z2);
    X4(add)(&z2, &x3, &z3);
    X4(mul)(&z3, &t0, &x2);
    X4(mul)(&z2, &z2, &t1);
    X4(sq)(&t0, &t1);
    X4(sq)(&t1, &x2);
    X4(add)(&x3, &z3, &z2);
    X4(sub)(&z2, &z3, &z2);
    X4(mul)(&x2, &t1, &t0);
    X4(sub)(&t1, &t1, &t0);
    X4(sq)(&z2, &z2);
    X4(mul_small)(&z3, &t1, 121666);
    X4(sq)(&x3, &x3);
    X4(add)(&t0, &t0, &z3);
    X4(mul)(&z3, &x1, &z2);
    X4(mul)(&z2, &t1, &t0);
  }
  X4(cswap)(&x2, &x3, swap); X4(cswap)(&z2, &z3, swap);
  X4(invert)(&z2, &z2);
  X4(mul)(&x2, &x2, &z2);
  X4(tobytes)(q, &x2);
}
#undef X4
#undef X4__
#undef X4_
