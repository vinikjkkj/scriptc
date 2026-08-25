/* JS-exact double → string.
 *
 * ECMA-262 §6.1.6.1.20 (Number::toString, radix 10) requires the shortest
 * digit string s (with digit count k and scale n, so that the value is
 * s * 10^(n-k)) that round-trips to the exact double — among equally short
 * candidates the closest, ties to even — then fixed placement for
 * -6 < n <= 21 and exponential notation otherwise.
 *
 * Digit generation is Ryū (vendored, see ../vendor/ryu/README.md): d2d()
 * computes exactly that shortest/closest/ties-even digit string with pure
 * integer arithmetic — no snprintf/strtod probing, no locale dependence.
 * The ECMA placement logic below is ours and unchanged; only the digit
 * source moved. Byte-exactness vs Node is pinned by the oracle case file
 * and the 1M-double fuzz gate (packages/runtime/test/gen-number-cases.mjs).
 */
#include "scr_runtime.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* Ryū d2s core, textually included so the build's runtime source list is
 * unchanged. Provides d2d(), d2d_small_int(), decimalLength17(), div10(). */
#include "../vendor/ryu/d2s.c"

/* The Ryū digit core, shared by the ECMA placement below and the Intl
 * en-US number formatter (scr_lib.c): the shortest round-tripping digit
 * string for a positive finite double — value = 0.digits × 10^n with no
 * trailing zeros. Returns k (the digit count, ≤ 17); digits is
 * NUL-terminated. Mirrors d2s_buffered_n's dispatch: the exact
 * small-integer fast path first (trailing decimal zeros folded into the
 * exponent), the full algorithm otherwise. */
int scr_f64_digits(double x, char digits[18], int *n_out) {
  uint64_t bits;
  memcpy(&bits, &x, sizeof bits);
  const uint64_t ieeeMantissa = bits & ((1ull << DOUBLE_MANTISSA_BITS) - 1);
  const uint32_t ieeeExponent =
      (uint32_t)(bits >> DOUBLE_MANTISSA_BITS); /* sign must be stripped */
  floating_decimal_64 v;
  if (d2d_small_int(ieeeMantissa, ieeeExponent, &v)) {
    for (;;) {
      const uint64_t q = div10(v.mantissa);
      const uint32_t r = ((uint32_t)v.mantissa) - 10 * ((uint32_t)q);
      if (r != 0) break;
      v.mantissa = q;
      ++v.exponent;
    }
  } else {
    v = d2d(ieeeMantissa, ieeeExponent);
  }

  /* Ryū's (mantissa, exponent) → ECMA's (digits, k, n): the k mantissa
   * digits have no trailing zeros, and value = 0.digits * 10^n. */
  int k = (int)decimalLength17(v.mantissa);
  *n_out = v.exponent + k;
  digits[k] = '\0';
  uint64_t m = v.mantissa;
  for (int i = k - 1; i >= 0; i--) {
    const uint64_t q = div10(m);
    digits[i] = (char)('0' + (uint32_t)m - 10 * (uint32_t)q);
    m = q;
  }
  return k;
}

/* Number.prototype.toString(radix) for radix != 10 (ECMA-262 §21.1.3.6).
 *
 * A faithful port of V8's DoubleToRadixCString: the value splits into an
 * integer part (digits generated high-to-low into the front of a buffer,
 * dividing by radix, padding zero digits while the double's binary
 * exponent proves the units place unrepresentable) and a fractional part
 * (digits generated low-to-high, multiplying by radix, with round-to-even
 * and carry back-propagation bounded by the input double's own ULP, so
 * exactly as many fractional digits as the value's precision warrants).
 * Radix 10 is the caller's job (scr_f64_to_str); a radix outside 2..36 is
 * the RangeError JS raises. Byte-exactness vs Node is the fuzz gate's job
 * (radix cross-product in gen-number-cases.mjs). */
ScrStr *scr_num_to_str_radix(double x, double radix_d) {
  int radix = (int)radix_d;
  if (radix < 2 || radix > 36 || (double)radix != radix_d) {
    scr_throw_error_named(scr_str_new("RangeError", 10),
                          scr_str_new("toRadix() radix must be an integer at least 2 and no greater than 36", 68));
    return NULL;
  }
  if (radix == 10) {
    char b[32];
    size_t n = scr_f64_to_str(x, b);
    return scr_str_new(b, n);
  }
  if (isnan(x)) return scr_str_new("NaN", 3);
  if (isinf(x)) return x < 0 ? scr_str_new("-Infinity", 9) : scr_str_new("Infinity", 8);
  if (x == 0) return scr_str_new("0", 1); /* covers -0 */

  static const char kChars[] = "0123456789abcdefghijklmnopqrstuvwxyz";
  /* Integer part up to 2^1024 (radix 2) needs ~1024 digits; the fraction,
   * bounded by the double's ULP, needs at most ~1100 for radix 2. */
  enum { INT_CAP = 1100, FRAC_CAP = 1100 };
  char int_buf[INT_CAP + 1];
  char frac_buf[FRAC_CAP];

  bool negative = x < 0;
  if (negative) x = -x;

  double integer = floor(x);
  double fraction = x - integer;
  /* delta = half the gap to the next representable double, floored at the
   * smallest positive double — the precision past which fractional digits
   * are noise. */
  double next = nextafter(x, INFINITY);
  double delta = 0.5 * (next - x);
  double tiny = nextafter(0.0, INFINITY);
  if (delta < tiny) delta = tiny;

  int frac_len = 0;
  if (fraction >= delta) {
    do {
      fraction *= radix;
      delta *= radix;
      int digit = (int)fraction;
      frac_buf[frac_len++] = kChars[digit];
      fraction -= digit;
      /* Round to even, propagating a carry that can reach the integer. */
      if (fraction > 0.5 || (fraction == 0.5 && (digit & 1))) {
        if (fraction + delta > 1) {
          for (;;) {
            frac_len--;
            if (frac_len < 0) {
              integer += 1; /* carry into the integer part */
              break;
            }
            char c = frac_buf[frac_len];
            int d = (c > '9') ? (c - 'a' + 10) : (c - '0');
            if (d + 1 < radix) {
              frac_buf[frac_len++] = kChars[d + 1];
              break;
            }
          }
          break;
        }
      }
    } while (fraction >= delta && frac_len < FRAC_CAP - 1);
  }

  /* Integer digits, high-to-low, filling the buffer from the back. Very
   * large integers (binary exponent past the 52-bit significand) have a
   * zero units digit that fmod could not recover — pad and divide down. */
  int cursor = INT_CAP;
  {
    uint64_t bits;
    double it = integer;
    while (it != 0) {
      memcpy(&bits, &it, sizeof bits);
      int exp = (int)((bits >> 52) & 0x7ff) - 1075;
      if (exp <= 0) break;
      int_buf[--cursor] = '0';
      it /= radix;
      it = floor(it);
    }
    do {
      double rem = fmod(it, radix);
      int_buf[--cursor] = kChars[(int)rem];
      it = floor((it - rem) / radix);
    } while (it > 0 && cursor > 0);
  }

  size_t int_len = (size_t)(INT_CAP - cursor);
  size_t total = (negative ? 1u : 0u) + int_len + (frac_len > 0 ? 1u + (size_t)frac_len : 0u);
  ScrStr *out = scr_str_alloc_raw(total, total);
  char *w = out->data;
  if (negative) *w++ = '-';
  memcpy(w, int_buf + cursor, int_len);
  w += int_len;
  if (frac_len > 0) {
    *w++ = '.';
    memcpy(w, frac_buf, (size_t)frac_len);
    w += frac_len;
  }
  *w = '\0';
  return out;
}

/* -- integer fast path for Number->string ----------------------------
 * The messaging profile puts scr_f64_to_scrstr at 10.9% of the whole
 * workload's cycles and 13.6% of SEND group's, and every one of those
 * 1.18M calls in the profiled run formats an EXACT NON-NEGATIVE INTEGER
 * (a sequence number, a unix timestamp) - the shape a JS program
 * stringifies more than any other. The general path pays Ryu for it:
 * d2d_small_int, then a div10 per trailing decimal zero to fold them
 * into the exponent, then decimalLength17, then a div10 per digit, then
 * a memcpy and a zero-padding loop to put the zeros back.
 *
 * WHY THE SHORTCUT IS EXACT, not merely close. ECMA-262 6.1.6.1.20 asks
 * for the SHORTEST digit string that round-trips. For an integer
 * 1 <= x < 2^53 every integer in the range is exactly representable and
 * consecutive integers are distinct doubles, so no decimal literal with
 * fewer significant digits can round to x - a shorter literal names some
 * other integer (or a value that rounds to one), never x. The shortest
 * round-tripping digit string for such an x is therefore its own exact
 * decimal expansion, which is what this writes. Placement agrees too:
 * x < 2^53 < 10^16 gives n <= 16 <= 21 and k <= n, so the general code
 * would take its "integer: digits then n-k zeros" arm and produce the
 * same bytes. NaN, +-Infinity, zero and the sign are all handled by the
 * caller before this point, and a non-integer or an x >= 2^53 falls
 * through to Ryu unchanged.
 *
 * SCR_F64_FAST_INT=0 removes it, which is what the ablation control is
 * built with. */
#ifndef SCR_F64_FAST_INT
#define SCR_F64_FAST_INT 1
#endif

#if SCR_F64_FAST_INT
static const char scr_dec2[201] =
    "00010203040506070809"
    "10111213141516171819"
    "20212223242526272829"
    "30313233343536373839"
    "40414243444546474849"
    "50515253545556575859"
    "60616263646566676869"
    "70717273747576777879"
    "80818283848586878889"
    "90919293949596979899";

/* 10^i, for the branchless decimal length below. */
static const uint64_t scr_p10[20] = {
    1ull, 10ull, 100ull, 1000ull, 10000ull, 100000ull, 1000000ull,
    10000000ull, 100000000ull, 1000000000ull, 10000000000ull,
    100000000000ull, 1000000000000ull, 10000000000000ull,
    100000000000000ull, 1000000000000000ull, 10000000000000000ull,
    100000000000000000ull, 1000000000000000000ull, 10000000000000000000ull};

/* How many decimal digits u has, in a fixed number of instructions.
 *
 * (64 - clz(v)) * 1233 >> 12 is floor(log10(2) * bitlength), which is the
 * digit count or one less, and the single compare against 10^t corrects it.
 * ryu's decimalLength17 answers the same question with a compare chain from
 * 17 downwards -- right for ryu, whose average output is 16.38 digits, and
 * wrong here: the census says 99.9% of the values this function formats have
 * three to five digits, which that chain reaches after thirteen comparisons.
 *
 * v = u | 1 keeps the function TOTAL. clzll(0) is undefined and 10^0 is the
 * one odd power of ten, so setting the low bit answers 1 for u == 0 and
 * changes nothing for u >= 1: it moves no value across an even power of ten,
 * and it cannot move the top set bit. */
static int scr_u64_len(uint64_t u) {
  const uint64_t v = u | 1u;
  const int t = (int)(((64 - __builtin_clzll(v)) * 1233) >> 12);
  return t + (v >= scr_p10[t] ? 1 : 0);
}

/* Decimal digits of u into out, two at a time, written BACK TO FRONT.
 *
 * The shipped shape generated digits low-to-high into a local tmp[20] and
 * then copied them out reversed, and that copy was measured at 38.85 of the
 * function's 135.81 instructions per call (28.6%) on a five-digit integer --
 * clang vectorises the reversal, so five bytes cost a 4-byte SSE byte-swap
 * plus twelve instructions of loop setup plus a scalar tail. Knowing the
 * length up front lets the digits land where they belong the first time: no
 * temporary, no second pass, no reversal.
 *
 * u < 2^53, so at most 16 digits. */
static int scr_u64_digits(char *out, uint64_t u) {
  const int len = scr_u64_len(u);
  char *p = out + len;
  while (u >= 100) {
    const uint32_t r = (uint32_t)(u % 100);
    u /= 100;
    p -= 2;
    p[0] = scr_dec2[r * 2];
    p[1] = scr_dec2[r * 2 + 1];
  }
  if (u >= 10) {
    const uint32_t r = (uint32_t)u;
    p -= 2;
    p[0] = scr_dec2[r * 2];
    p[1] = scr_dec2[r * 2 + 1];
  } else {
    *--p = (char)('0' + (uint32_t)u);
  }
  return len;
}
#endif

/* ── SCR_F64_CENSUS: what values does this function actually see? ─────
 * Off unless -DSCR_F64_CENSUS is on the command line, in which case the
 * build-cache key differs and an instrumented binary never shares an
 * entry with a clean one (backend/cc.ts, SCRIPTC_PROF_CFLAGS).
 *
 * Reported through atexit(), NOT __attribute__((destructor)): these PE
 * binaries have no .CRT section and a destructor never runs, while its
 * format string stays in the image so a byte scan calls it present.
 * process.exit() ends in _Exit(), which skips atexit as well, so
 * scr_process_exit calls the flush directly under the same #ifdef.
 * scr_f64_census_flush is idempotent: whichever path fires first wins.
 *
 * The line is deliberately unlike anything a program prints, on stderr,
 * so it can never be confused with the workload's own output. A run that
 * prints no SCF64 line at all is DID-NOT-RUN, not "zero calls". */
#ifdef SCR_F64_CENSUS
#include <stdlib.h>
static unsigned long long scr_f64c_total, scr_f64c_nan, scr_f64c_inf, scr_f64c_zero,
    scr_f64c_neg, scr_f64c_int, scr_f64c_big, scr_f64c_frac;
static unsigned long long scr_f64c_dig[20];
static int scr_f64c_done;

void scr_f64_census_flush(void);
void scr_f64_census_flush(void) {
  if (scr_f64c_done) return;
  scr_f64c_done = 1;
  fprintf(stderr,
          "SCF64 total=%llu nan=%llu inf=%llu zero=%llu neg=%llu int=%llu frac=%llu big=%llu\n",
          scr_f64c_total, scr_f64c_nan, scr_f64c_inf, scr_f64c_zero, scr_f64c_neg,
          scr_f64c_int, scr_f64c_frac, scr_f64c_big);
  fprintf(stderr, "SCF64 intdigits");
  for (int i = 1; i <= 17; i++) fprintf(stderr, " %d:%llu", i, scr_f64c_dig[i]);
  fprintf(stderr, "\n");
  fflush(stderr);
}

static void scr_f64_census(double x) {
  if (scr_f64c_total == 0) atexit(scr_f64_census_flush);
  scr_f64c_total++;
  if (isnan(x)) { scr_f64c_nan++; return; }
  if (x == 0) { scr_f64c_zero++; return; }
  if (isinf(x)) { scr_f64c_inf++; return; }
  double a = x;
  if (a < 0) { scr_f64c_neg++; a = -a; }
  if (a >= 9007199254740992.0) { scr_f64c_big++; return; }
  unsigned long long u = (unsigned long long)a;
  if ((double)u != a) { scr_f64c_frac++; return; }
  scr_f64c_int++;
  int d = 1;
  while (u >= 10) { u /= 10; d++; }
  scr_f64c_dig[d]++;
}
#endif

/* The shortest-round-trip tail: ryu digit generation plus the ECMA-262
 * 6.1.6.1.20 placement arms. COLD and NOINLINE, and both halves are
 * measured. Inlined here it costs the fast path a frame it never uses:
 * the four placement arms need enough live registers that the prologue
 * saved six callee-saved registers and the fast path paid 17 instructions
 * of push/pop per call plus 8 more of spill glue, for an integer whose
 * whole formatting is a division loop. scr_array.c already does this for
 * the same reason (SCR_ARR_COLD).
 *
 * out is buf, or buf + 1 when the sign was already written. */
static __attribute__((noinline, cold)) size_t scr_f64_to_str_slow(double x, char *buf, char *out) {
  char digits[18];
  int n;
  int k = scr_f64_digits(x, digits, &n);

  if (k <= n && n <= 21) {
    /* Integer: digits followed by n-k zeros. */
    memcpy(out, digits, (size_t)k);
    out += k;
    for (int i = 0; i < n - k; i++) *out++ = '0';
  } else if (0 < n && n <= 21) {
    /* ddd.ddd */
    memcpy(out, digits, (size_t)n);
    out += n;
    *out++ = '.';
    memcpy(out, digits + n, (size_t)(k - n));
    out += k - n;
  } else if (-6 < n && n <= 0) {
    /* 0.000ddd */
    *out++ = '0';
    *out++ = '.';
    for (int i = 0; i < -n; i++) *out++ = '0';
    memcpy(out, digits, (size_t)k);
    out += k;
  } else {
    /* d.ddde±e — exponent is n-1, printed without leading zeros. */
    *out++ = digits[0];
    if (k > 1) {
      *out++ = '.';
      memcpy(out, digits + 1, (size_t)(k - 1));
      out += k - 1;
    }
    *out++ = 'e';
    int e = n - 1;
    *out++ = e < 0 ? '-' : '+';
    if (e < 0) e = -e;
    char etmp[8];
    int elen = 0;
    do {
      etmp[elen++] = (char)('0' + e % 10);
      e /= 10;
    } while (e > 0);
    while (elen > 0) *out++ = etmp[--elen];
  }
  *out = '\0';
  return (size_t)(out - buf);
}

size_t scr_f64_to_str(double x, char *buf) {
#ifdef SCR_F64_CENSUS
  scr_f64_census(x);
#endif
  /* Zero, NaN and both infinities out of ONE load of the bits.
   *
   * isnan()/isinf() are the only reason this function is platform-divergent:
   * mingw expands them to __isnan()/__fpclassify() calls where glibc expands
   * them to __builtin_isnan/__builtin_isinf_sign, and
   * tests/perf/platform-divergence.mjs listed scr_f64_to_str as one of the
   * two DIVERGENT functions in this file at every tier. Shifting the sign
   * out leaves the magnitude: 0 is the two zeros, 0x7ff<<53 is the two
   * infinities, and anything above it is a NaN. Same answers, no libm macro,
   * one platform. */
  uint64_t bits;
  memcpy(&bits, &x, sizeof bits);
  const uint64_t mag = bits << 1; /* sign shifted out */
  if (mag == 0) return (size_t)(stpcpy(buf, "0") - buf); /* covers -0 */
  if (mag >= 0xffe0000000000000ull) {
    if (mag > 0xffe0000000000000ull) return (size_t)(stpcpy(buf, "NaN") - buf);
    return (size_t)(stpcpy(buf, (bits >> 63) != 0 ? "-Infinity" : "Infinity") - buf);
  }

  char *out = buf;
  if ((bits >> 63) != 0) {
    *out++ = '-';
    x = -x;
  }

#if SCR_F64_FAST_INT
  /* x is finite, strictly positive and sign-stripped here. */
  if (x < 9007199254740992.0) { /* 2^53 */
    /* SIGNED, deliberately. x is strictly positive and below 2^53 here, so
     * both directions are exact either way -- but double -> uint64_t is
     * eight instructions on x86-64 (the compare-against-2^63 dance) and
     * uint64_t -> double is nine (punpckldq/subpd/unpckhpd/addsd), against
     * one cvttsd2si and one cvtsi2sd for the signed pair. Measured at 21.00
     * of the function's 135.81 instructions per call. */
    const int64_t i = (int64_t)x;
    if ((double)i == x) {
      out += scr_u64_digits(out, (uint64_t)i);
      *out = 0;
      return (size_t)(out - buf);
    }
  }
#endif

  return scr_f64_to_str_slow(x, buf, out);
}
