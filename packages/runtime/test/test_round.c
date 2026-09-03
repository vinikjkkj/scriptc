/* Math.floor / Math.trunc / Math.ceil: scr_floor/scr_trunc/scr_ceil against
 * the library functions they replace, compared as BITS.
 *
 * Why bits and not values. The three differ from a naive int64 cast only on
 * negative zero -- JS answers -0 for Math.trunc(-0.5), Math.ceil(-0.5) and
 * all three of Math.floor(-0)/trunc(-0)/ceil(-0) -- and `==` cannot see
 * that, because -0.0 == 0.0. A comparator that used `==` would pass a
 * rounding path that is wrong on -0.5 and answer MATCH for a WRONG value,
 * which is strictly worse than the call it replaced. So every comparison
 * here goes through the payload, and same_bits() is positive-controlled at
 * the end of main against a deliberately naive cast: if the comparator
 * cannot see that error, the program exits nonzero instead of reporting
 * success.
 *
 * The inputs are every value the window's edges care about -- the two
 * infinities, NaN, both zeros, halves either side of zero, 2^53, 2^63 and
 * its neighbour, DBL_MAX/MIN/TRUE_MIN, values past the int64 window -- plus
 * 64 nextafter steps in each direction from each of them (that is where an
 * off-by-one-ulp window bound shows up), a dense fractional sweep, and a
 * pseudorandom sweep over raw bit patterns so exponents nothing else
 * reaches get covered too. The random stream is a fixed-seed xorshift, so a
 * failure here reproduces exactly.
 *
 * -DSCR_NO_FASTARM routes all three to the library functions, which makes
 * the whole sweep a tautology -- that arm proves the switch reaches all
 * three and that the harness runs the same sweep either way. round.test.ts
 * compiles both arms and requires the same case count from each.
 *
 * This file links ALONE. Everything under test -- the three rounding arms
 * and the knob reader behind them -- is a static inline in scr_runtime.h,
 * so there is no library to link and nothing to keep in step. */
#include "../src/scr_runtime.h"

#include <float.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static long long cases = 0, bad = 0;

/* One NaN is every NaN here: JS has a single NaN value and neither arm is
 * asked to preserve a payload. Everything else compares as bits, so +0 and
 * -0 are DIFFERENT. */
static int same_bits(double a, double b) {
  uint64_t ua, ub;
  if (a != a && b != b) return 1;
  memcpy(&ua, &a, 8);
  memcpy(&ub, &b, 8);
  return ua == ub;
}

static void report(const char *op, double x, double got, double want) {
  bad++;
  if (bad <= 20)
    fprintf(stderr, "FAIL %s(%.20g): got %.20g want %.20g\n", op, x, got, want);
}

static void one(double x) {
  cases++;
  double g, w;
  g = scr_floor(x); w = floor(x); if (!same_bits(g, w)) report("floor", x, g, w);
  g = scr_trunc(x); w = trunc(x); if (!same_bits(g, w)) report("trunc", x, g, w);
  g = scr_ceil(x);  w = ceil(x);  if (!same_bits(g, w)) report("ceil", x, g, w);
}

static const double EDGES[] = {
  0.0, -0.0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.5, -2.5,
  0.9999999999999999, -0.9999999999999999,
  4503599627370495.5, -4503599627370495.5,          /* 2^52 - 0.5 */
  9007199254740991.0, -9007199254740991.0,          /* 2^53 - 1 */
  9007199254740992.0, -9007199254740992.0,          /* 2^53 */
  9223372036854775808.0, -9223372036854775808.0,    /* 2^63, the window edge */
  9223372036854774784.0, -9223372036854774784.0,    /* the double below 2^63 */
  4611686018427387904.0, -4611686018427387904.0,    /* 2^62 */
  2147483647.5, -2147483648.5, 4294967296.5, -4294967296.5,
  1e300, -1e300, 1e-300, -1e-300, 1e18, -1e18,
  DBL_MAX, -DBL_MAX, DBL_MIN, -DBL_MIN, DBL_TRUE_MIN, -DBL_TRUE_MIN,
};

int main(void) {
  const unsigned nedges = (unsigned)(sizeof EDGES / sizeof EDGES[0]);

  one((double)NAN);
  one((double)INFINITY);
  one(-(double)INFINITY);
  for (unsigned i = 0; i < nedges; i++) one(EDGES[i]);

  /* An off-by-one-ulp window bound is invisible at the edge itself. */
  for (unsigned i = 0; i < nedges; i++) {
    double up = EDGES[i], dn = EDGES[i];
    for (int k = 0; k < 64; k++) {
      up = nextafter(up, (double)INFINITY);
      dn = nextafter(dn, -(double)INFINITY);
      one(up);
      one(dn);
    }
  }

  /* Dense fractional sweep across zero: 1/1024 steps over [-512, 512]. */
  for (long k = -524288; k <= 524288; k++) one((double)k / 1024.0);

  /* Raw bit patterns, fixed seed, plus a scaled variant so plenty of them
   * land in the exponent range where the fast arm actually runs. */
  uint64_t s = 0x243F6A8885A308D3ULL;
  for (long long k = 0; k < 400000; k++) {
    double d;
    s ^= s << 13; s ^= s >> 7; s ^= s << 17;
    memcpy(&d, &s, 8);
    one(d);
    one((double)(int64_t)(s >> 11) / 1048576.0);
    one((double)(int64_t)(s >> 11));
  }

  fprintf(stderr, "%lld/%lld cases passed\n", cases - bad, cases);

  /* POSITIVE CONTROL. A naive int64 cast is wrong on exactly one thing --
   * it answers +0 where -0 was due -- and if same_bits cannot see that,
   * every "passed" line above is worthless. */
  double naive = (double)(int64_t)(-0.5);
  if (same_bits(naive, trunc(-0.5))) {
    fputs("POSITIVE CONTROL FAILED: the comparator cannot see a -0 error, so "
          "the sweep above proves nothing\n", stderr);
    return 3;
  }
  if (cases < 2000000) {
    fprintf(stderr, "POSITIVE CONTROL FAILED: only %lld cases ran; the sweep "
                    "did not happen\n", cases);
    return 3;
  }
  fputs("positive control armed: a +0-for--0 answer is caught\n", stderr);
  return bad == 0 ? 0 : 1;
}
