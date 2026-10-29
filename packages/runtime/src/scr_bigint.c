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
  scr_bigint_alloc_note();
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
  if (--b->rc == 0) {
    scr_bigint_free_note();
    free(b);
  }
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
    /* The oracle is the PINNED Node (v24.15.0, .node-version), whose V8
     * formats this RangeError with a missing template argument: it prints
     * "undefined must be positive". Measured on v24.15.0 and v22.18.0:
     *   2n ** -1n -> RangeError: undefined must be positive
     * and on v25.9.0 it prints "Exponent must be positive". The runtime
     * follows the pin, so the v25 wording would fail the corpus program
     * 2881-bigint-throwing-operators. The literal is 26 bytes long. */
    scr_throw_error_msg(SCR_ERR_RANGE, "undefined must be positive", 26);
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

/* BigInt.asIntN(bits, v) / BigInt.asUintN(bits, v): v MODULO 2^bits, read
 * as two's complement or unsigned. One operation, the signedness apart.
 *
 * It is how a 64-bit integer library splits a bigint into 32-bit halves —
 * `long`'s own constructor, which is why this exists:
 *
 *     Long.fromBigInt = (v, u) => fromBits(Number(BigInt.asIntN(32, v)),
 *                                          Number(BigInt.asIntN(32, v >> 32n)), u)
 *
 * `bits` is the spec's ToIndex: NaN is 0, a fraction truncates, and
 * negative or above 2^53-1 is Node's "Invalid value: not (convertible to)
 * a safe integer" RangeError.
 *
 * A width the value ALREADY fits in is the identity, answered before any
 * allocation: V8 gives BigInt.asIntN(2**31, 5n) as 5n without building a
 * two-gigabit window, and so does this. Past that the window is at most
 * one limb wider than the operand — except a NEGATIVE operand read
 * unsigned, which genuinely has 2^bits digits, and which takes V8's own
 * "Maximum BigInt size exceeded" RangeError above 2^30 bits (measured on
 * Node v25.9.0: asUintN(2**30 + 1, -1n) throws exactly that).
 *
 * Throws catchably and answers zero — the family's total-C-signature
 * convention (see scr_big_div). */
ScrBigInt *scr_big_as_n(const ScrBigInt *a, double bits_d, bool is_signed) {
  double bd = (bits_d != bits_d) ? 0 : trunc(bits_d);
  if (!(bd >= 0) || bd > 9007199254740991.0) {
    static const char msg[] = "Invalid value: not (convertible to) a safe integer";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
    return scr_big_zero();
  }
  /* a's whole two's complement — magnitude limbs plus one sign bit — fits
   * in a->n * 32 + 1 bits, so a width at least that wide changes nothing
   * (signed), and changes nothing for a NON-NEGATIVE value either way. */
  if (bd >= (double)a->n * 32.0 + 1.0 && (is_signed || a->sign >= 0)) {
    return scr_big_retain((ScrBigInt *)a);
  }
  if (bd > 1073741824.0) { /* 2^30 — V8's maximum BigInt width */
    static const char msg[] = "Maximum BigInt size exceeded";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
    return scr_big_zero();
  }
  uint64_t bits = (uint64_t)bd;
  if (bits == 0) return scr_big_zero();
  size_t w = (size_t)((bits + 31) / 32); /* limbs covering bits 0..bits-1 */
  size_t wz = w + 1;                     /* +1: a sign limb the mask owns */
  uint32_t *t = malloc(wz * sizeof(uint32_t));
  if (!t) scr_big_oom();
  scr_big_to_twos(a, wz, t);
  /* Clear every bit at or above `bits` — the modulus. */
  unsigned top = (unsigned)(bits & 31u); /* 0 means the last limb is full */
  if (top != 0) t[w - 1] &= (uint32_t)((1u << top) - 1u);
  t[wz - 1] = 0;
  if (is_signed) {
    /* Bit bits-1 IS the sign of the window; a set one means every bit
     * from `bits` up is set in the value scr_big_from_twos must read. */
    if (((t[(size_t)((bits - 1) / 32)] >> (unsigned)((bits - 1) & 31u)) & 1u) != 0) {
      if (top != 0) t[w - 1] |= (uint32_t) ~(uint32_t)((1u << top) - 1u);
      t[wz - 1] = SCR_BIG_LIMB_MAX;
    }
  }
  ScrBigInt *r = scr_big_from_twos(t, wz);
  free(t);
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

/* The low 64 bits of the INFINITE two's-complement representation — the
 * spec's ToBigUint64/ToBigInt64 in the only form a caller needs, since
 * the two produce the same bits and differ only in how they read back.
 * Never allocates and never throws: negative values are complemented in
 * place, and a value wider than 64 bits simply loses its high limbs,
 * which IS the modulus. */
uint64_t scr_big_low_u64(const ScrBigInt *a) {
  uint64_t mag = 0;
  if (a->n > 0) mag = a->limbs[0];
  if (a->n > 1) mag |= (uint64_t)a->limbs[1] << 32;
  return a->sign < 0 ? (uint64_t)(~mag + 1u) : mag;
}

/* setBigUint64/setBigInt64 — the same eight-byte scatter, over a value
 * that is a BigInt rather than a double. The spec's coercion is
 * ToBigUint64/ToBigInt64: the value modulo 2^64. The two differ only in
 * how the RESULT would read back, and the stored bits are identical, so
 * one path serves both.
 *
 * Bounds are the getters' — ToIndex on the offset, then the view-relative
 * check, with Node's ONE constant message. It runs BEFORE the modulus,
 * which is also Node's order (the value was already coerced by the caller
 * evaluating BigInt(...); nothing here can throw for it). */
void scr_dataview_set_big(ScrBytes *b, double byte_off, const ScrBigInt *value, bool le) {
  double off = (byte_off != byte_off) ? 0 : trunc(byte_off);
  if (!(off >= 0) || off > 9007199254740991.0 || off + 8.0 > (double)b->len) {
    static const char msg[] = "Offset is outside the bounds of the DataView";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
    return;
  }
  uint64_t u = scr_big_low_u64(value);
  uint8_t *p = b->data + (size_t)off;
  for (size_t i = 0; i < 8; i++) {
    p[le ? i : 8 - 1 - i] = (uint8_t)(u >> (8 * i));
  }
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
  /* Digits per 32-bit limb is 32/log2(base): ten and a bit for decimal,
   * but THIRTY-TWO for radix 2. The bound here used to be 11 — the
   * decimal one — so every radix below 8 wrote past the end of this heap
   * block once the value was wide enough to outrun the +2 slack. Measured
   * from inside this function (written bytes vs the old cap):
   *
   *     limbs   r=2    r=3   r=4   r=5   r=6   r=7  | r=8   r=10
   *        5   +74    +26    +9     .     .     .   |   .      .
   *        6  +124    +54   +29   +16    +7    +2   |   .      .
   *       16  +334   +146   +78   +43   +21    +5   |   .      .
   *
   * Radix 8 and up are safe at every width (11 covers 32/3), which is why
   * decimal never showed it. The worst case over the legal range 2..36 is
   * radix 2's 32 digits per limb, so bound it there once and every radix
   * is covered: 32*n digits, plus the sign, plus one spare. */
  size_t cap = a->n * 32 + 2;
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

/* StringToBigInt (ECMA-262 7.1.14) behind BigInt(string): surrounding JS
 * whitespace trimmed, the empty string is 0n, an optionally signed decimal
 * integer, or an UNSIGNED 0x/0o/0b literal with at least one digit. Anything
 * else (a fraction, `1n`, `1_0`, `-0x1`, a stray character) is a SyntaxError
 * whose message is V8's: "Cannot convert <the string> to a BigInt". Borrows
 * `s`; +1 or NULL with the exception pending. */
ScrBigInt *scr_big_from_str(const ScrStr *s) {
  ScrStr *t = scr_str_trim((ScrStr *)s); /* +1 */
  const char *p = t->data;
  size_t n = t->len;
  bool ok = true;
  size_t i = 0;
  int base = 10;
  if (n == 0) {
    scr_str_release(t);
    return scr_big_zero();
  }
  if (n > 2 && p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) { base = 16; i = 2; }
  else if (n > 2 && p[0] == '0' && (p[1] == 'o' || p[1] == 'O')) { base = 8; i = 2; }
  else if (n > 2 && p[0] == '0' && (p[1] == 'b' || p[1] == 'B')) { base = 2; i = 2; }
  else if (p[0] == '+' || p[0] == '-') i = 1;
  if (i >= n) ok = false;
  for (size_t k = i; ok && k < n; k++) {
    char c = p[k];
    int d = (c >= '0' && c <= '9') ? c - '0'
            : (c >= 'a' && c <= 'f') ? c - 'a' + 10
            : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : 99;
    if (d >= base) ok = false;
  }
  if (!ok) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Cannot convert ");
    scr_jb_write(&b, s->data, s->len);
    scr_jb_puts(&b, " to a BigInt");
    scr_str_release(t);
    scr_throw_error(SCR_ERR_SYNTAX, scr_jb_finish(&b));
    return NULL;
  }
  ScrBigInt *r = scr_big_parse(p, n);
  scr_str_release(t);
  return r;
}

/* ToBigInt (ECMA-262 7.1.13) over an UNTYPED operand — `BigInt(u)`.
 * Lives here rather than in scr_json.c for the gating reason the boxing
 * ops below spell out, and it may call INTO the always-linked core
 * freely: the dependency this file must not create is the other
 * direction.
 *
 * Node's answers, measured against v25.9.0:
 *   BigInt(5)      -> 5n            BigInt(5.5) -> RangeError
 *   BigInt(true)   -> 1n            BigInt(null) -> TypeError
 *   BigInt(5n)     -> 5n            BigInt("5") -> 5n
 *   BigInt("12abc") -> SyntaxError  BigInt([7]) -> 7n (ToPrimitive, then the
 *                                   string arm)
 * The string arm is scr_big_from_str (the literal parser scr_big_parse skips
 * characters it does not know, so it only ever sees text already validated). */
static ScrBigInt *scr_big_to_bigint_impl(const ScrDyn *d, bool strict) {
  if (d != NULL) {
    switch (d->kind) {
    case SCR_DYN_BIG:
      /* The identity, exactly as the static BigInt(bigint) spelling. */
      return scr_big_retain(scr_dyn_big_of((ScrDyn *)d));
    case SCR_DYN_NUM:
      if (strict) {
        /* ToBigInt (not the BigInt() function): a number has no conversion.
         * BigInt.asIntN(32, 5) is "Cannot convert 5 to a BigInt". */
        char num[32];
        size_t numlen = scr_f64_to_str(d->v.num, num);
        ScrJsonBuf b;
        scr_jb_init(&b);
        scr_jb_puts(&b, "Cannot convert ");
        scr_jb_write(&b, num, numlen);
        scr_jb_puts(&b, " to a BigInt");
        scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
        return NULL;
      }
      /* scr_big_from_f64 owns the integrality RangeError, so the number
       * arm and the static BigInt(number) arm are literally one code
       * path and cannot disagree. */
      return scr_big_from_f64(d->v.num);
    case SCR_DYN_BOOL:
      /* ToBigInt(true) is 1n and ToBigInt(false) is 0n — the one arm with
       * no shared code path, because there is no static BigInt(boolean)
       * spelling for it to share with. */
      return d->v.b ? scr_big_from_f64(1) : scr_big_zero();
    default:
      break;
    }
  }
  /* The two units get Node MESSAGE-EXACT TypeErrors (measured:
   * "Cannot convert null to a BigInt"). */
  if (d == NULL || d->kind == SCR_DYN_UNDEF || d->kind == SCR_DYN_NULL) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Cannot convert ");
    scr_jb_puts(&b, (d == NULL || d->kind == SCR_DYN_UNDEF) ? "undefined" : "null");
    scr_jb_puts(&b, " to a BigInt");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return NULL;
  }
  /* A string, or an object/array reaching a string through ToPrimitive. */
  ScrStr *str = d->kind == SCR_DYN_STR ? scr_str_retain(scr_dyn_str_value(d)) : scr_dyn_to_primitive_string(d);
  if (str == NULL) return NULL;
  ScrBigInt *r = scr_big_from_str(str);
  scr_str_release(str);
  return r;
}

ScrBigInt *scr_big_from_dyn(const ScrDyn *d) { return scr_big_to_bigint_impl(d, false); }

/* ToBigInt proper (ECMA-262 7.1.13), the conversion BigInt.asIntN/asUintN
 * apply to their value: the BigInt() function's table except that a number
 * is a TypeError. */
ScrBigInt *scr_big_to_bigint(const ScrDyn *d) { return scr_big_to_bigint_impl(d, true); }

/* ── the checked-dynamic crossing (SCR_DYN_BIG) ───────────────────────
 *
 * A bigint flowing into an `unknown` slot. The five value questions the
 * always-linked dyn core has to ask a bigint live HERE, in the gated
 * unit, and reach the core through a table it installs — the
 * ScrDynJsvalOps arrangement, adopted for its link-time reason rather
 * than its style: scr_json.c is always linked and this file is not, so a
 * scr_big_release() called from there would be an undefined symbol in
 * every bigint-free binary. That is not hypothetical — it is exactly how
 * scr_big_low_u64 broke the LLVM lane one change ago, and the accounting
 * test now asserts this file's gating stays intact.
 *
 * Not one line of behaviour is new: every entry is an existing scr_big_*
 * export, so `String(u)` on a boxed bigint runs the same digits routine
 * as `String(x)` on a static one and the two cannot answer differently.
 *
 * A LITERAL retain, not a copy: bigints are immutable, so the box and the
 * static value sharing digits is unobservable, and === over two boxes
 * compares VALUES anyway (scr_dyn_strict_eq's BIG arm). */
/* `bigint == number` (IsLooselyEqual 7.2.14 step 12-13): a number that is
 * not an integer (NaN, +-Infinity, fractional) equals no bigint; an integral
 * one compares by exact value. */
static bool scr_big_eq_f64(const ScrBigInt *b, double n) {
  if (!isfinite(n) || n != trunc(n)) return false;
  ScrBigInt *m = scr_big_from_f64(n);
  bool eq = scr_big_eq(b, m);
  scr_big_release(m);
  return eq;
}

static bool scr_big_ws(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f';
}

/* `bigint == string`: StringToBigInt (7.1.14) over the string - surrounding
 * whitespace trimmed, empty is 0n, an optionally signed decimal or an
 * UNSIGNED 0x/0o/0b literal; anything else is "no value", and the
 * comparison is false. */
static bool scr_big_eq_str(const ScrBigInt *b, const ScrStr *s) {
  const char *p = (const char *)s->data;
  size_t n = s->len;
  while (n && scr_big_ws(*p)) { p++; n--; }
  while (n && scr_big_ws(p[n - 1])) n--;
  if (n == 0) return !scr_big_truthy(b);
  size_t i = 0;
  int base = 10;
  if (n > 2 && p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) { base = 16; i = 2; }
  else if (n > 2 && p[0] == '0' && (p[1] == 'o' || p[1] == 'O')) { base = 8; i = 2; }
  else if (n > 2 && p[0] == '0' && (p[1] == 'b' || p[1] == 'B')) { base = 2; i = 2; }
  else if (p[0] == '+' || p[0] == '-') i = 1;
  if (i >= n) return false;
  for (size_t k = i; k < n; k++) {
    char c = p[k];
    int d = (c >= '0' && c <= '9') ? c - '0'
            : (c >= 'a' && c <= 'f') ? c - 'a' + 10
            : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : 99;
    if (d >= base) return false;
  }
  ScrBigInt *m = scr_big_parse(p, n);
  bool eq = scr_big_eq(b, m);
  scr_big_release(m);
  return eq;
}

/* IsLessThan's BigInt arms (7.2.13 steps 4-7): the order of b against a
 * bigint, a number (exact, never through a rounded double), or a string
 * (StringToBigInt; a string that is no BigInt is UNORDERED, answer 2). */
static int scr_big_rel_big(const ScrBigInt *a, const ScrBigInt *b) {
  int c = scr_big_cmp(a, b);
  return c < 0 ? -1 : (c > 0 ? 1 : 0);
}

static int scr_big_rel_f64(const ScrBigInt *b, double n) {
  if (n != n) return 2;
  if (n == INFINITY) return -1;
  if (n == -INFINITY) return 1;
  double fl = floor(n);
  ScrBigInt *m = scr_big_from_f64(fl);
  int c = scr_big_rel_big(b, m);
  scr_big_release(m);
  if (c == 0 && n != fl) return -1; /* b == floor(n), and n is above it */
  return c;
}

static int scr_big_rel_str(const ScrBigInt *b, const ScrStr *s) {
  const char *p = (const char *)s->data;
  size_t n = s->len;
  while (n && scr_big_ws(*p)) { p++; n--; }
  while (n && scr_big_ws(p[n - 1])) n--;
  ScrBigInt *m;
  if (n == 0) {
    m = scr_big_zero();
  } else {
    size_t i = 0;
    int base = 10;
    if (n > 2 && p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) { base = 16; i = 2; }
    else if (n > 2 && p[0] == '0' && (p[1] == 'o' || p[1] == 'O')) { base = 8; i = 2; }
    else if (n > 2 && p[0] == '0' && (p[1] == 'b' || p[1] == 'B')) { base = 2; i = 2; }
    else if (p[0] == '+' || p[0] == '-') i = 1;
    if (i >= n) return 2;
    for (size_t k = i; k < n; k++) {
      char c = p[k];
      int d = (c >= '0' && c <= '9') ? c - '0'
              : (c >= 'a' && c <= 'f') ? c - 'a' + 10
              : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : 99;
      if (d >= base) return 2;
    }
    m = scr_big_parse(p, n);
  }
  int c = scr_big_rel_big(b, m);
  scr_big_release(m);
  return c;
}

static const ScrDynBigOps scr_big_dyn_ops = {
  scr_big_retain,
  scr_big_release,
  scr_big_truthy,
  scr_big_eq,
  scr_big_to_str,
  scr_big_eq_f64,
  scr_big_eq_str,
  scr_big_low_u64,
  scr_big_rel_big,
  scr_big_rel_f64,
  scr_big_rel_str,
  scr_big_to_f64,
};

ScrDyn *scr_dyn_from_big(ScrBigInt *b) {
  return scr_dyn_alloc_big(b, &scr_big_dyn_ops);
}

/* 64 raw bits as the bigint they spell: DataView.prototype.getBigInt64 /
 * getBigUint64 on a dynamic receiver. Installed through
 * scr_dyn_big_from_bits_fn by the emitted main(). The box takes its own
 * reference (scr_dyn_alloc_big retains), so ours is released. */
static ScrDyn *scr_big_dyn_from_bits(uint64_t bits, bool is_signed) {
  ScrBigInt *b = (is_signed && (int64_t)bits < 0) ? scr_big_from_u64_signed(~bits + 1u, -1)
                                                   : scr_big_from_u64_signed(bits, 1);
  ScrDyn *d = scr_dyn_from_big(b);
  scr_big_release(b);
  return d;
}

/* The BigInt write ladder for a Buffer (scr_json.c, scr_dyn_big_store_fn): the 64-bit two's-complement bits
 * when the value fits the signed or unsigned range, else Node's Received rendering in `shown` (digit groups
 * of three with _, then the n suffix). */
static int scr_big_store_check(const ScrDyn *v, bool is_signed, uint64_t *bits, char *shown, size_t cap) {
  if (v == NULL || v->kind != SCR_DYN_BIG) return 0;
  const ScrBigInt *b = v->v.big;
  ScrBigInt *fit = scr_big_as_n(b, 64, is_signed);
  bool ok = scr_big_eq(fit, b);
  scr_big_release(fit);
  if (ok) {
    *bits = scr_big_low_u64(b);
    return 1;
  }
  ScrStr *s = scr_big_to_str(b, 10);
  const char *dp = s->data;
  size_t dl = s->len;
  bool neg = dl > 0 && dp[0] == '-';
  if (neg) { dp++; dl--; }
  size_t g = 0;
  if (neg && g + 1 < cap) shown[g++] = '-';
  for (size_t i = 0; i < dl && g + 2 < cap; i++) {
    if (i > 0 && (dl - i) % 3 == 0 && g + 2 < cap) shown[g++] = '_';
    shown[g++] = dp[i];
  }
  if (g + 1 < cap) shown[g++] = 'n';
  shown[g] = '\0';
  scr_str_release(s);
  return 0;
}

static void scr_big_dyn_store(ScrBytes *b, size_t idx, const ScrDyn *v);
static ScrDyn *scr_big_dyn_load(const ScrBytes *b, size_t idx);

void scr_big_dyn_install(void) {
  scr_dyn_big_from_bits_fn = scr_big_dyn_from_bits;
  scr_dyn_big_store_fn = scr_big_store_check;
  scr_dyn_bytes_big_store_fn = scr_big_dyn_store;
  scr_dyn_bytes_big_load_fn = scr_big_dyn_load;
}

/* ── BigInt64Array / BigUint64Array elements ──────────────────────────── */

/* The element read: eight bytes, two's complement for BigInt64, unsigned for
 * BigUint64. The magnitude of a negative int64 is the unsigned negation,
 * exact for INT64_MIN as well. Fresh +1 bigint, like every bigint producer. */
ScrBigInt *scr_bytes_get_big(const ScrBytes *b, double i) {
  const size_t idx = scr_bytes_index_checked(b, i);
  if (b->elem == SCR_BYTES_U64) {
    uint64_t u;
    memcpy(&u, b->data + idx * 8, 8);
    return scr_big_from_u64_signed(u, 1);
  }
  int64_t s;
  memcpy(&s, b->data + idx * 8, 8);
  if (s >= 0) return scr_big_from_u64_signed((uint64_t)s, 1);
  const uint64_t mag = (uint64_t)0 - (uint64_t)s;
  return scr_big_from_u64_signed(mag, -1);
}

/* The element write: the value's low 64 bits. That residue IS ToBigInt64
 * (signed reinterpretation) and ToBigUint64, so one store serves both views
 * and out-of-range values wrap exactly as the spec's modular conversion. */
void scr_bytes_set_big(ScrBytes *b, double i, const ScrBigInt *v) {
  const size_t idx = scr_bytes_index_checked(b, i);
  const uint64_t bits = scr_big_low_u64(v);
  memcpy(b->data + idx * 8, &bits, 8);
}

/* ── BigInt64Array / BigUint64Array methods (fill, search, sort) ───────── */

/* ToIntegerOrInfinity then the relative clamp Node's TypedArray methods use:
 * a negative value counts from the end, the result stays in [0, len]. NaN is
 * zero (the omitted argument arrives as NaN from the emitters). */
static size_t scr_big_rel(double x, size_t len) {
  if (x != x) return 0;
  double t = trunc(x);
  if (t < 0) {
    t += (double)len;
    if (t < 0) return 0;
  }
  if (t > (double)len) return len;
  return (size_t)t;
}

/* fill(value, start?, end?): every element in [start, end) takes the value's
 * low 64 bits. `nargs` is how many of start/end were passed (0, 1 or 2). The
 * receiver answers +1 for chaining, as the other fills do. */
ScrBytes *scr_bytes_fill_big(ScrBytes *b, const ScrBigInt *v, double nargs, double from, double to) {
  const size_t len = b->len;
  const size_t start = nargs >= 1 ? scr_big_rel(from, len) : 0;
  const size_t end = nargs >= 2 ? scr_big_rel(to, len) : len;
  const uint64_t bits = scr_big_low_u64(v);
  for (size_t i = start; i < end; i++) memcpy(b->data + i * 8, &bits, 8);
  return scr_bytes_retain(b);
}

/* indexOf / includes by value, from `from` (NaN = 0), forwards. Returns the
 * index or -1. Equality is the bigint value (both views' elements are exact
 * 64-bit values, so the boxed compare is the strict/SameValueZero one). */
double scr_bytes_index_of_big(const ScrBytes *b, const ScrBigInt *v, double from) {
  const size_t len = b->len;
  for (size_t i = scr_big_rel(from, len); i < len; i++) {
    ScrBigInt *e = scr_bytes_get_big(b, (double)i);
    const bool same = scr_big_eq(e, v);
    scr_big_release(e);
    if (same) return (double)i;
  }
  return -1.0;
}

static int scr_big_cmp_i64(const void *pa, const void *pb) {
  int64_t a, b;
  memcpy(&a, pa, 8);
  memcpy(&b, pb, 8);
  return a < b ? -1 : a > b ? 1 : 0;
}

static int scr_big_cmp_u64(const void *pa, const void *pb) {
  uint64_t a, b;
  memcpy(&a, pa, 8);
  memcpy(&b, pb, 8);
  return a < b ? -1 : a > b ? 1 : 0;
}

/* sort() on a bigint view: ascending by value, in place (the signed view
 * orders as int64, the unsigned as uint64). Answers the receiver +1. */
ScrBytes *scr_bytes_sort_big(ScrBytes *b) {
  if (b->len > 1) {
    qsort(b->data, b->len, 8, b->elem == SCR_BYTES_U64 ? scr_big_cmp_u64 : scr_big_cmp_i64);
  }
  return scr_bytes_retain(b);
}

/* new BigInt64Array(bigints) / set(bigints): the values of a bigint array,
 * converted element by element (each value's low 64 bits, ToBigInt64 /
 * ToBigUint64). The source array is only read; each element is borrowed for
 * the store (scr_arr_get_ref answers +1, released here). Fresh +1 view. */
ScrBytes *scr_bytes_from_bigs(ScrBytesElem elem, ScrArr *arr) {
  ScrBytes *b = scr_bytes_new(elem, (double)arr->len);
  for (size_t i = 0; i < arr->len; i++) {
    ScrBigInt *v = (ScrBigInt *)scr_arr_get_ref(arr, (double)i);
    scr_bytes_set_big(b, (double)i, v);
    scr_big_release(v);
  }
  return b;
}

/* lastIndexOf by value: from the end, or from `from` (NaN = the last index).
 * Node: a negative `from` counts from the end; -Infinity finds nothing. */
double scr_bytes_last_index_of_big(const ScrBytes *b, const ScrBigInt *v, double from) {
  const size_t len = b->len;
  if (len == 0) return -1.0;
  double k;
  if (from != from) {
    k = (double)len - 1.0;
  } else {
    double t = trunc(from);
    if (t == -INFINITY) return -1.0;
    k = t >= 0 ? (t < (double)len - 1.0 ? t : (double)len - 1.0) : (double)len + t;
  }
  for (double i = k; i >= 0.0; i -= 1.0) {
    ScrBigInt *e = scr_bytes_get_big(b, i);
    const bool same = scr_big_eq(e, v);
    scr_big_release(e);
    if (same) return i;
  }
  return -1.0;
}

/* The whole view as a bigint[] (rest destructuring of a bigint view): each
 * element is a fresh bigint whose ownership moves into the array. */
ScrArr *scr_bytes_big_array(const ScrBytes *b) {
  ScrArr *a = scr_arr_new_ref(scr_big_retain_v, scr_big_release_v, NULL, b->len);
  for (size_t i = 0; i < b->len; i++) scr_arr_push_ref(a, scr_bytes_get_big(b, (double)i));
  return a;
}

/* ── BigInt views in the checked-dynamic tree ─────────────────────────── */

/* ToBigInt for a typed-array store (ECMA-262 7.1.13): a bigint as is, a
 * boolean as 0n / 1n, a string parsed, and a number, undefined or null a
 * TypeError. NULL with the exception pending when it throws. */
static ScrBigInt *scr_big_to_store(const ScrDyn *v) {
  switch (v->kind) {
    case SCR_DYN_BIG:
      return scr_big_retain(v->v.big);
    case SCR_DYN_BOOL:
      return v->v.b ? scr_big_from_f64(1.0) : scr_big_zero();
    case SCR_DYN_STR:
      return scr_big_from_str(v->v.str);
    default:
      break;
  }
  char msg[96];
  int n;
  if (v->kind == SCR_DYN_NUM) {
    char num[64];
    const size_t nl = scr_f64_to_str(v->v.num, num); /* JS ToString; scr_number.c is always linked */
    n = snprintf(msg, sizeof msg, "Cannot convert %.*s to a BigInt", (int)nl, num);
  } else if (v->kind == SCR_DYN_NULL) {
    n = snprintf(msg, sizeof msg, "Cannot convert null to a BigInt");
  } else {
    n = snprintf(msg, sizeof msg, "Cannot convert undefined to a BigInt");
  }
  scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
  return NULL;
}

/* A keyed store into a bigint view: ToBigInt FIRST (a bad value throws even
 * out of range), then the element when the index is in bounds. */
static void scr_big_dyn_store(ScrBytes *b, size_t idx, const ScrDyn *v) {
  ScrBigInt *x = scr_big_to_store(v);
  if (x == NULL) return;
  if (idx < b->len) scr_bytes_set_big(b, (double)idx, x);
  scr_big_release(x);
}

/* A keyed read of a bigint view: the element as a bigint box. */
static ScrDyn *scr_big_dyn_load(const ScrBytes *b, size_t idx) {
  /* The box retains its own reference (scr_dyn_alloc_big), so the element's
   * +1 is released here, after boxing. */
  ScrBigInt *x = scr_bytes_get_big(b, (double)idx);
  ScrDyn *d = scr_dyn_from_big(x);
  scr_big_release(x);
  return d;
}
