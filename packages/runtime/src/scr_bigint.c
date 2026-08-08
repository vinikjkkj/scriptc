/* JS BigInt — arbitrary-precision integers, sign-magnitude over base 2^32
 * limbs. Compiled ONLY when the program uses bigint (cc.ts gates it exactly
 * like scr_regex.c/scr_zlib.c), so bigint-free binaries keep their historical
 * link line and size class.
 *
 * Semantics are JS's, not C's:
 *   - `/` and `%` TRUNCATE toward zero (`-7n / 2n === -3n`, `-7n % 2n === -1n`),
 *     which is what makes the `r >= 0n ? r : r + m` modulus idiom work.
 *   - `&`, `|`, `^`, `~`, `>>` act on the INFINITE two's-complement
 *     representation, so they are defined for negative operands: this file
 *     converts to a two's-complement window, operates, and converts back
 *     rather than refusing (a refusal would diverge from Node silently).
 *   - `>>` is an arithmetic shift that FLOORS (`-1n >> 1n === -1n`).
 *   - Division by zero throws Node's catchable RangeError.
 *
 * Division is binary long division, not Knuth D. bigint here serves key
 * material and modular reduction — hundreds of ops per handshake, not a hot
 * loop — and the simpler algorithm is the one whose correctness is checkable
 * by reading it. */
#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SCR_BIG_LIMB_BITS 32
#define SCR_BIG_LIMB_MAX 0xffffffffu

static void scr_big_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* ── allocation ───────────────────────────────────────────────────────── */

static ScrBigInt *scr_big_alloc(size_t cap) {
  if (cap == 0) cap = 1;
  if (cap > (SIZE_MAX - sizeof(ScrBigInt)) / sizeof(uint32_t)) scr_big_oom();
  ScrBigInt *b = malloc(sizeof(ScrBigInt) + cap * sizeof(uint32_t));
  if (!b) scr_big_oom();
  b->rc = 1;
  b->sign = 0;
  b->n = 0;
  b->cap = cap;
  return b;
}

/* Drop leading zero limbs and normalize the zero sign — every producer ends
 * here, so `n == 0` iff the value is zero, and `sign` is never 0 otherwise. */
static void scr_big_trim(ScrBigInt *b) {
  while (b->n > 0 && b->limbs[b->n - 1] == 0) b->n--;
  if (b->n == 0) b->sign = 0;
  else if (b->sign == 0) b->sign = 1;
}

ScrBigInt *scr_big_retain(ScrBigInt *b) {
  if (b && b->rc != SIZE_MAX) b->rc++;
  return b;
}

void scr_big_release(ScrBigInt *b) {
  if (!b || b->rc == SIZE_MAX) return;
  if (--b->rc == 0) free(b);
}

ScrBigInt *scr_big_zero(void) {
  return scr_big_alloc(1);
}

static ScrBigInt *scr_big_from_u64_signed(uint64_t mag, int sign) {
  ScrBigInt *b = scr_big_alloc(2);
  b->limbs[0] = (uint32_t)(mag & SCR_BIG_LIMB_MAX);
  b->limbs[1] = (uint32_t)(mag >> 32);
  b->n = 2;
  b->sign = sign;
  scr_big_trim(b);
  return b;
}

/* ── magnitude helpers ────────────────────────────────────────────────── */

static int scr_big_cmp_mag(const ScrBigInt *a, const ScrBigInt *b) {
  if (a->n != b->n) return a->n < b->n ? -1 : 1;
  for (size_t i = a->n; i-- > 0;) {
    if (a->limbs[i] != b->limbs[i]) return a->limbs[i] < b->limbs[i] ? -1 : 1;
  }
  return 0;
}

static ScrBigInt *scr_big_add_mag(const ScrBigInt *a, const ScrBigInt *b, int sign) {
  size_t n = (a->n > b->n ? a->n : b->n) + 1;
  ScrBigInt *r = scr_big_alloc(n);
  uint64_t carry = 0;
  for (size_t i = 0; i < n; i++) {
    uint64_t s = carry;
    if (i < a->n) s += a->limbs[i];
    if (i < b->n) s += b->limbs[i];
    r->limbs[i] = (uint32_t)(s & SCR_BIG_LIMB_MAX);
    carry = s >> 32;
  }
  r->n = n;
  r->sign = sign;
  scr_big_trim(r);
  return r;
}

/* |a| - |b|, requiring |a| >= |b|. */
static ScrBigInt *scr_big_sub_mag(const ScrBigInt *a, const ScrBigInt *b, int sign) {
  ScrBigInt *r = scr_big_alloc(a->n ? a->n : 1);
  int64_t borrow = 0;
  for (size_t i = 0; i < a->n; i++) {
    int64_t d = (int64_t)a->limbs[i] - borrow - (i < b->n ? (int64_t)b->limbs[i] : 0);
    if (d < 0) {
      d += ((int64_t)1 << 32);
      borrow = 1;
    } else {
      borrow = 0;
    }
    r->limbs[i] = (uint32_t)d;
  }
  r->n = a->n;
  r->sign = sign;
  scr_big_trim(r);
  return r;
}

/* ── arithmetic ───────────────────────────────────────────────────────── */

ScrBigInt *scr_big_add(const ScrBigInt *a, const ScrBigInt *b) {
  if (a->sign == 0) return scr_big_retain((ScrBigInt *)b);
  if (b->sign == 0) return scr_big_retain((ScrBigInt *)a);
  if (a->sign == b->sign) return scr_big_add_mag(a, b, a->sign);
  int c = scr_big_cmp_mag(a, b);
  if (c == 0) return scr_big_zero();
  return c > 0 ? scr_big_sub_mag(a, b, a->sign) : scr_big_sub_mag(b, a, b->sign);
}

ScrBigInt *scr_big_neg(const ScrBigInt *a) {
  if (a->sign == 0) return scr_big_zero();
  ScrBigInt *r = scr_big_alloc(a->n);
  memcpy(r->limbs, a->limbs, a->n * sizeof(uint32_t));
  r->n = a->n;
  r->sign = -a->sign;
  return r;
}

ScrBigInt *scr_big_sub(const ScrBigInt *a, const ScrBigInt *b) {
  ScrBigInt *nb = scr_big_neg(b);
  ScrBigInt *r = scr_big_add(a, nb);
  scr_big_release(nb);
  return r;
}

ScrBigInt *scr_big_mul(const ScrBigInt *a, const ScrBigInt *b) {
  if (a->sign == 0 || b->sign == 0) return scr_big_zero();
  size_t n = a->n + b->n;
  ScrBigInt *r = scr_big_alloc(n);
  memset(r->limbs, 0, n * sizeof(uint32_t));
  for (size_t i = 0; i < a->n; i++) {
    uint64_t carry = 0;
    for (size_t j = 0; j < b->n; j++) {
      uint64_t cur = (uint64_t)r->limbs[i + j] + (uint64_t)a->limbs[i] * b->limbs[j] + carry;
      r->limbs[i + j] = (uint32_t)(cur & SCR_BIG_LIMB_MAX);
      carry = cur >> 32;
    }
    size_t k = i + b->n;
    while (carry) {
      uint64_t cur = (uint64_t)r->limbs[k] + carry;
      r->limbs[k] = (uint32_t)(cur & SCR_BIG_LIMB_MAX);
      carry = cur >> 32;
      k++;
    }
  }
  r->n = n;
  r->sign = a->sign * b->sign;
  scr_big_trim(r);
  return r;
}

static size_t scr_big_bitlen(const ScrBigInt *a) {
  if (a->n == 0) return 0;
  uint32_t top = a->limbs[a->n - 1];
  size_t bits = (a->n - 1) * SCR_BIG_LIMB_BITS;
  while (top) {
    bits++;
    top >>= 1;
  }
  return bits;
}

static bool scr_big_bit(const ScrBigInt *a, size_t i) {
  size_t limb = i / SCR_BIG_LIMB_BITS;
  if (limb >= a->n) return false;
  return (a->limbs[limb] >> (i % SCR_BIG_LIMB_BITS)) & 1u;
}

static void scr_big_set_bit(ScrBigInt *a, size_t i) {
  a->limbs[i / SCR_BIG_LIMB_BITS] |= (uint32_t)1u << (i % SCR_BIG_LIMB_BITS);
}

/* Shift the magnitude left by one bit in place; cap must already allow it. */
static void scr_big_shl1_mag(ScrBigInt *a) {
  uint32_t carry = 0;
  for (size_t i = 0; i < a->n; i++) {
    uint32_t next = a->limbs[i] >> 31;
    a->limbs[i] = (a->limbs[i] << 1) | carry;
    carry = next;
  }
  if (carry) {
    a->limbs[a->n] = carry;
    a->n++;
  }
}

/* Binary long division over MAGNITUDES: quotient and remainder both
 * non-negative, sign applied by the callers (JS truncates toward zero, so the
 * remainder takes the DIVIDEND's sign and the quotient the product of signs). */
static void scr_big_divmod_mag(const ScrBigInt *a, const ScrBigInt *b, ScrBigInt **q_out,
                               ScrBigInt **r_out) {
  size_t bits = scr_big_bitlen(a);
  ScrBigInt *q = scr_big_alloc(a->n ? a->n : 1);
  memset(q->limbs, 0, q->cap * sizeof(uint32_t));
  q->n = a->n;
  ScrBigInt *r = scr_big_alloc(b->n + 1);
  memset(r->limbs, 0, r->cap * sizeof(uint32_t));
  r->n = 0;
  for (size_t i = bits; i-- > 0;) {
    scr_big_shl1_mag(r);
    if (r->n == 0) r->n = 1;
    if (scr_big_bit(a, i)) r->limbs[0] |= 1u;
    /* r >= |b| ⇒ subtract and set the quotient bit. */
    r->sign = r->n ? 1 : 0;
    if (scr_big_cmp_mag(r, b) >= 0) {
      ScrBigInt *nr = scr_big_sub_mag(r, b, 1);
      scr_big_release(r);
      r = scr_big_alloc(b->n + 1);
      memset(r->limbs, 0, r->cap * sizeof(uint32_t));
      memcpy(r->limbs, nr->limbs, nr->n * sizeof(uint32_t));
      r->n = nr->n;
      scr_big_release(nr);
      scr_big_set_bit(q, i);
    }
  }
  q->sign = 1;
  scr_big_trim(q);
  r->sign = 1;
  scr_big_trim(r);
  *q_out = q;
  *r_out = r;
}

static void scr_big_div_zero(void) {
  scr_throw_error_msg(SCR_ERR_RANGE, "Division by zero", 16);
}

ScrBigInt *scr_big_div(const ScrBigInt *a, const ScrBigInt *b) {
  if (b->sign == 0) {
    scr_big_div_zero();
    return scr_big_zero();
  }
  if (a->sign == 0) return scr_big_zero();
  ScrBigInt *q = NULL, *r = NULL;
  scr_big_divmod_mag(a, b, &q, &r);
  scr_big_release(r);
  q->sign = q->n ? a->sign * b->sign : 0;
  return q;
}

ScrBigInt *scr_big_rem(const ScrBigInt *a, const ScrBigInt *b) {
  if (b->sign == 0) {
    scr_big_div_zero();
    return scr_big_zero();
  }
  if (a->sign == 0) return scr_big_zero();
  ScrBigInt *q = NULL, *r = NULL;
  scr_big_divmod_mag(a, b, &q, &r);
  scr_big_release(q);
  /* JS `%` keeps the DIVIDEND's sign (truncated division). */
  r->sign = r->n ? a->sign : 0;
  return r;
}

ScrBigInt *scr_big_pow(const ScrBigInt *a, const ScrBigInt *b) {
  if (b->sign < 0) {
    /* V8's wording, which is what Node prints: "positive", not
     * "non-negative" — the zero exponent is handled below and never
     * reaches here, so the two phrasings describe the same guard and
     * only one of them matches the oracle. Invisible until the
     * may-throw seed made the message reachable by a `catch`. */
    scr_throw_error_msg(SCR_ERR_RANGE, "Exponent must be positive", 25);
    return scr_big_zero();
  }
  if (b->sign == 0) return scr_big_from_u64_signed(1, 1);
  /* An exponent past 2^32 cannot produce a representable result before OOM;
   * the multiply loop would trap there anyway, so read it as a u64. */
  uint64_t e = 0;
  for (size_t i = b->n; i-- > 0;) {
    if (i >= 2) {
      scr_big_oom();
    }
    e = (e << 32) | b->limbs[i];
  }
  ScrBigInt *result = scr_big_from_u64_signed(1, 1);
  ScrBigInt *base = scr_big_retain((ScrBigInt *)a);
  while (e) {
    if (e & 1) {
      ScrBigInt *t = scr_big_mul(result, base);
      scr_big_release(result);
      result = t;
    }
    e >>= 1;
    if (e) {
      ScrBigInt *t = scr_big_mul(base, base);
      scr_big_release(base);
      base = t;
    }
  }
  scr_big_release(base);
  return result;
}

/* ── shifts ───────────────────────────────────────────────────────────── */

static uint64_t scr_big_shift_count(const ScrBigInt *b) {
  uint64_t s = 0;
  for (size_t i = b->n; i-- > 0;) {
    if (i >= 2) scr_big_oom();
    s = (s << 32) | b->limbs[i];
  }
  return s;
}

static ScrBigInt *scr_big_shl_bits(const ScrBigInt *a, uint64_t s) {
  if (a->sign == 0) return scr_big_zero();
  size_t limbShift = (size_t)(s / SCR_BIG_LIMB_BITS);
  unsigned bitShift = (unsigned)(s % SCR_BIG_LIMB_BITS);
  size_t n = a->n + limbShift + 1;
  ScrBigInt *r = scr_big_alloc(n);
  memset(r->limbs, 0, n * sizeof(uint32_t));
  for (size_t i = 0; i < a->n; i++) {
    uint64_t v = (uint64_t)a->limbs[i] << bitShift;
    r->limbs[i + limbShift] |= (uint32_t)(v & SCR_BIG_LIMB_MAX);
    r->limbs[i + limbShift + 1] |= (uint32_t)(v >> 32);
  }
  r->n = n;
  r->sign = a->sign;
  scr_big_trim(r);
  return r;
}

/* Magnitude-only right shift, used by the FLOORING signed shift below. */
static ScrBigInt *scr_big_shr_bits_mag(const ScrBigInt *a, uint64_t s) {
  size_t limbShift = (size_t)(s / SCR_BIG_LIMB_BITS);
  unsigned bitShift = (unsigned)(s % SCR_BIG_LIMB_BITS);
  if (limbShift >= a->n) return scr_big_zero();
  size_t n = a->n - limbShift;
  ScrBigInt *r = scr_big_alloc(n);
  for (size_t i = 0; i < n; i++) {
    uint64_t v = a->limbs[i + limbShift] >> bitShift;
    if (bitShift && i + limbShift + 1 < a->n) {
      v |= (uint64_t)a->limbs[i + limbShift + 1] << (SCR_BIG_LIMB_BITS - bitShift);
    }
    r->limbs[i] = (uint32_t)(v & SCR_BIG_LIMB_MAX);
  }
  r->n = n;
  r->sign = 1;
  scr_big_trim(r);
  return r;
}

/* True when any of the low `s` bits of |a| is set — the rounding test that
 * turns a magnitude shift into the FLOOR that JS's `>>` performs. */
static bool scr_big_low_bits_set(const ScrBigInt *a, uint64_t s) {
  for (uint64_t i = 0; i < s; i++) {
    if (i / SCR_BIG_LIMB_BITS >= a->n) return false;
    if (scr_big_bit(a, (size_t)i)) return true;
  }
  return false;
}

ScrBigInt *scr_big_shl(const ScrBigInt *a, const ScrBigInt *b) {
  if (b->sign < 0) {
    ScrBigInt *nb = scr_big_neg(b);
    ScrBigInt *r = scr_big_shr(a, nb);
    scr_big_release(nb);
    return r;
  }
  return scr_big_shl_bits(a, scr_big_shift_count(b));
}

ScrBigInt *scr_big_shr(const ScrBigInt *a, const ScrBigInt *b) {
  if (b->sign < 0) {
    ScrBigInt *nb = scr_big_neg(b);
    ScrBigInt *r = scr_big_shl(a, nb);
    scr_big_release(nb);
    return r;
  }
  uint64_t s = scr_big_shift_count(b);
  if (a->sign >= 0) return scr_big_shr_bits_mag(a, s);
  /* Negative: arithmetic shift FLOORS, so a truncated magnitude shift is one
   * too large in absolute value whenever any shifted-out bit was set
   * (`-3n >> 1n === -2n`, `-4n >> 1n === -2n`). */
  ScrBigInt *mag = scr_big_shr_bits_mag(a, s);
  mag->sign = mag->n ? -1 : 0;
  if (scr_big_low_bits_set(a, s)) {
    ScrBigInt *one = scr_big_from_u64_signed(1, 1);
    ScrBigInt *r = scr_big_sub(mag, one);
    scr_big_release(one);
    scr_big_release(mag);
    return r;
  }
  return mag;
}

/* ── bitwise over the infinite two's-complement representation ────────── */

/* Fill `out[0..w)` with a's two's-complement limbs sign-extended to width w. */
static void scr_big_to_twos(const ScrBigInt *a, size_t w, uint32_t *out) {
  if (a->sign >= 0) {
    for (size_t i = 0; i < w; i++) out[i] = i < a->n ? a->limbs[i] : 0;
    return;
  }
  uint64_t carry = 1;
  for (size_t i = 0; i < w; i++) {
    uint64_t v = (uint64_t)(uint32_t)~(i < a->n ? a->limbs[i] : 0u) + carry;
    out[i] = (uint32_t)(v & SCR_BIG_LIMB_MAX);
    carry = v >> 32;
  }
}

/* The inverse: a width-w two's-complement window back to sign-magnitude. */
static ScrBigInt *scr_big_from_twos(const uint32_t *buf, size_t w) {
  bool negative = w > 0 && (buf[w - 1] >> 31) != 0;
  ScrBigInt *r = scr_big_alloc(w);
  if (!negative) {
    for (size_t i = 0; i < w; i++) r->limbs[i] = buf[i];
    r->n = w;
    r->sign = 1;
    scr_big_trim(r);
    return r;
  }
  uint64_t carry = 1;
  for (size_t i = 0; i < w; i++) {
    uint64_t v = (uint64_t)(uint32_t)~buf[i] + carry;
    r->limbs[i] = (uint32_t)(v & SCR_BIG_LIMB_MAX);
    carry = v >> 32;
  }
  r->n = w;
  r->sign = -1;
  scr_big_trim(r);
  if (r->n == 0) r->sign = 0;
  return r;
}

typedef enum { SCR_BIG_AND, SCR_BIG_OR, SCR_BIG_XOR } ScrBigBitOp;

static ScrBigInt *scr_big_bitop(const ScrBigInt *a, const ScrBigInt *b, ScrBigBitOp op) {
  size_t w = (a->n > b->n ? a->n : b->n) + 1;
  uint32_t *ta = malloc(w * sizeof(uint32_t));
  uint32_t *tb = malloc(w * sizeof(uint32_t));
  uint32_t *tr = malloc(w * sizeof(uint32_t));
  if (!ta || !tb || !tr) scr_big_oom();
  scr_big_to_twos(a, w, ta);
  scr_big_to_twos(b, w, tb);
  for (size_t i = 0; i < w; i++) {
    tr[i] = op == SCR_BIG_AND ? (ta[i] & tb[i]) : op == SCR_BIG_OR ? (ta[i] | tb[i]) : (ta[i] ^ tb[i]);
  }
  ScrBigInt *r = scr_big_from_twos(tr, w);
  free(ta);
  free(tb);
  free(tr);
  return r;
}

ScrBigInt *scr_big_and(const ScrBigInt *a, const ScrBigInt *b) {
  return scr_big_bitop(a, b, SCR_BIG_AND);
}
ScrBigInt *scr_big_or(const ScrBigInt *a, const ScrBigInt *b) {
  return scr_big_bitop(a, b, SCR_BIG_OR);
}
ScrBigInt *scr_big_xor(const ScrBigInt *a, const ScrBigInt *b) {
  return scr_big_bitop(a, b, SCR_BIG_XOR);
}

/* ~x === -x - 1 over the infinite representation. */
ScrBigInt *scr_big_not(const ScrBigInt *a) {
  ScrBigInt *neg = scr_big_neg(a);
  ScrBigInt *one = scr_big_from_u64_signed(1, 1);
  ScrBigInt *r = scr_big_sub(neg, one);
  scr_big_release(neg);
  scr_big_release(one);
  return r;
}

/* ── comparison ───────────────────────────────────────────────────────── */

int scr_big_cmp(const ScrBigInt *a, const ScrBigInt *b) {
  if (a->sign != b->sign) return a->sign < b->sign ? -1 : 1;
  int c = scr_big_cmp_mag(a, b);
  return a->sign < 0 ? -c : c;
}

bool scr_big_eq(const ScrBigInt *a, const ScrBigInt *b) {
  return scr_big_cmp(a, b) == 0;
}

bool scr_big_truthy(const ScrBigInt *a) {
  return a->sign != 0;
}

/* ── conversions ──────────────────────────────────────────────────────── */

/* Multiply the magnitude by `m` and add `d`, both small — the digit loop of
 * every base-N parse below. */
static void scr_big_mul_add_small(ScrBigInt **bp, uint32_t m, uint32_t d) {
  ScrBigInt *b = *bp;
  uint64_t carry = d;
  for (size_t i = 0; i < b->n; i++) {
    uint64_t cur = (uint64_t)b->limbs[i] * m + carry;
    b->limbs[i] = (uint32_t)(cur & SCR_BIG_LIMB_MAX);
    carry = cur >> 32;
  }
  while (carry) {
    if (b->n == b->cap) {
      ScrBigInt *nb = scr_big_alloc(b->cap * 2 + 1);
      memcpy(nb->limbs, b->limbs, b->n * sizeof(uint32_t));
      nb->n = b->n;
      nb->sign = b->sign;
      scr_big_release(b);
      b = nb;
      *bp = b;
    }
    b->limbs[b->n] = (uint32_t)(carry & SCR_BIG_LIMB_MAX);
    b->n++;
    carry >>= 32;
  }
  if (b->sign == 0 && b->n > 0) b->sign = 1;
}

/* The literal's own spelling, decimal or 0x/0o/0b, WITHOUT the `n` suffix and
 * with numeric separators already removed by the compiler. */
ScrBigInt *scr_big_parse(const char *s, size_t len) {
  size_t i = 0;
  int sign = 1;
  if (i < len && (s[i] == '-' || s[i] == '+')) {
    if (s[i] == '-') sign = -1;
    i++;
  }
  uint32_t base = 10;
  if (i + 1 < len && s[i] == '0') {
    char c = s[i + 1];
    if (c == 'x' || c == 'X') { base = 16; i += 2; }
    else if (c == 'o' || c == 'O') { base = 8; i += 2; }
    else if (c == 'b' || c == 'B') { base = 2; i += 2; }
  }
  ScrBigInt *r = scr_big_alloc(4);
  memset(r->limbs, 0, r->cap * sizeof(uint32_t));
  for (; i < len; i++) {
    char c = s[i];
    uint32_t d;
    if (c >= '0' && c <= '9') d = (uint32_t)(c - '0');
    else if (c >= 'a' && c <= 'f') d = (uint32_t)(c - 'a' + 10);
    else if (c >= 'A' && c <= 'F') d = (uint32_t)(c - 'A' + 10);
    else continue;
    scr_big_mul_add_small(&r, base, d);
  }
  scr_big_trim(r);
  if (r->n > 0) r->sign = sign;
  return r;
}

/* BigInt(number): integral doubles only — Node throws RangeError otherwise. */
ScrBigInt *scr_big_from_f64(double v) {
  if (!isfinite(v) || v != trunc(v)) {
    /* V8 names the offending value and the reason, and the reason is
     * "not an integer" — NOT "not a safe integer": BigInt(2**60 + 0.0)
     * is fine and BigInt(1.5) is not, so safety never enters it. The
     * number renders shortest-roundtrip, so Infinity/NaN print by name
     * exactly as the oracle does. */
    char num[32];
    size_t numlen = scr_f64_to_str(v, num);
    char msg[112];
    int mlen = snprintf(msg, sizeof msg,
                        "The number %.*s cannot be converted to a BigInt because it is not an integer",
                        (int)numlen, num);
    scr_throw_error_msg(SCR_ERR_RANGE, msg, (size_t)mlen);
    return scr_big_zero();
  }
  int sign = v < 0 ? -1 : (v > 0 ? 1 : 0);
  double mag = fabs(v);
  ScrBigInt *r = scr_big_alloc(4);
  memset(r->limbs, 0, r->cap * sizeof(uint32_t));
  /* Peel 32 bits at a time off the top; ldexp/fmod keep every step exact for
   * a value that is already an integer. */
  size_t bits = 0;
  double probe = mag;
  while (probe >= 1.0) {
    probe = floor(probe / 4294967296.0);
    bits += 32;
  }
  for (size_t shift = bits; shift > 0; shift -= 32) {
    double chunk = floor(mag / ldexp(1.0, (int)(shift - 32)));
    chunk = fmod(chunk, 4294967296.0);
    ScrBigInt *shifted = scr_big_shl_bits(r, 32);
    scr_big_release(r);
    r = shifted;
    scr_big_mul_add_small(&r, 1, (uint32_t)chunk);
  }
  scr_big_trim(r);
  if (r->n > 0) r->sign = sign;
  return r;
}

double scr_big_to_f64(const ScrBigInt *a) {
  double out = 0;
  for (size_t i = a->n; i-- > 0;) {
    out = out * 4294967296.0 + (double)a->limbs[i];
  }
  return a->sign < 0 ? -out : out;
}

/* Decimal (or radix 2..36) rendering — repeated small division, digits
 * emitted least-significant first and reversed. */
ScrStr *scr_big_to_str(const ScrBigInt *a, double radix) {
  uint32_t base = (uint32_t)radix;
  if (base < 2 || base > 36) base = 10;
  if (a->sign == 0) return scr_str_new("0", 1);
  size_t cap = a->n * 11 + 2;
  char *buf = malloc(cap);
  if (!buf) scr_big_oom();
  uint32_t *work = malloc(a->n * sizeof(uint32_t));
  if (!work) scr_big_oom();
  memcpy(work, a->limbs, a->n * sizeof(uint32_t));
  size_t wn = a->n;
  size_t len = 0;
  while (wn > 0) {
    uint64_t rem = 0;
    for (size_t i = wn; i-- > 0;) {
      uint64_t cur = (rem << 32) | work[i];
      work[i] = (uint32_t)(cur / base);
      rem = cur % base;
    }
    while (wn > 0 && work[wn - 1] == 0) wn--;
    buf[len++] = (char)(rem < 10 ? '0' + rem : 'a' + (rem - 10));
  }
  if (a->sign < 0) buf[len++] = '-';
  for (size_t i = 0, j = len - 1; i < j; i++, j--) {
    char t = buf[i];
    buf[i] = buf[j];
    buf[j] = t;
  }
  ScrStr *s = scr_str_new(buf, len);
  free(buf);
  free(work);
  return s;
}

/* The void* adapters ScrArr/ScrMap element tables call through. */
void *scr_big_retain_v(void *b) { return scr_big_retain((ScrBigInt *)b); }
void scr_big_release_v(void *b) { scr_big_release((ScrBigInt *)b); }
