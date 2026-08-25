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

/* Decimal digits of u >= 1 into out, two at a time; returns the count.
   u < 2^53 so at most 16 digits, and tmp[20] cannot overflow. */
static int scr_u64_digits(char *out, uint64_t u) {
  char tmp[20];
  int n = 0;
  while (u >= 100) {
    uint32_t r = (uint32_t)(u % 100);
    u /= 100;
    tmp[n++] = scr_dec2[r * 2 + 1];
    tmp[n++] = scr_dec2[r * 2];
  }
  if (u >= 10) {
    uint32_t r = (uint32_t)u;
    tmp[n++] = scr_dec2[r * 2 + 1];
    tmp[n++] = scr_dec2[r * 2];
  } else {
    tmp[n++] = (char)('0' + (uint32_t)u);
  }
  for (int i = n - 1; i >= 0; i--) *out++ = tmp[i];
  return n;
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

size_t scr_f64_to_str(double x, char *buf) {
#ifdef SCR_F64_CENSUS
  scr_f64_census(x);
#endif
  if (isnan(x)) return (size_t)(stpcpy(buf, "NaN") - buf);
  if (x == 0) return (size_t)(stpcpy(buf, "0") - buf); /* covers -0 */
  if (isinf(x)) {
    return (size_t)(stpcpy(buf, x < 0 ? "-Infinity" : "Infinity") - buf);
  }

  char *out = buf;
  if (x < 0) {
    *out++ = '-';
    x = -x;
  }

#if SCR_F64_FAST_INT
  /* x is finite, strictly positive and sign-stripped here. */
  if (x < 9007199254740992.0) { /* 2^53 */
    uint64_t u = (uint64_t)x;
    if ((double)u == x) {
      out += scr_u64_digits(out, u);
      *out = 0;
      return (size_t)(out - buf);
    }
  }
#endif

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
