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

size_t scr_f64_to_str(double x, char *buf) {
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
