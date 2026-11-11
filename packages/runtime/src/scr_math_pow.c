/* Math.pow and the ** operator, in a TU of their own that links only into programs which call them (the link line checks the emitted program
 * for scr_math_pow). On Windows this is what pulls the vendored scr_arm_pow.c (about a page of code and tables) into the binary, so a program
 * that never raises a power does not pay for it. Nothing else in the runtime calls these. */
#include "scr_runtime.h"

#include <math.h>

/* The platform pow, the one Node calls. V8's Math.pow rounds like the ARM optimized-routines pow glibc uses on a modern x86-64, on every
 * platform; the Windows C runtime's pow differs in the last bit for a few samples in a thousand (row 24940: pow(-396976.1611328125, -2) is
 * 6.345577383695e-12 in Node and 6.345577383694999e-12 from the Windows pow, and ucrtbase's pow gave the same answer as mingw's). So the Windows
 * arm calls the vendored routine (scr_arm_pow.c, bit-for-bit glibc's on 20 million samples) when the CPU can run it, and the C runtime otherwise;
 * every other platform calls pow(), which is that algorithm already. */
#ifdef _WIN32
static double scr_platform_pow(double x, double y) {
  static int arm = -1;
  if (__builtin_expect(arm < 0, 0)) arm = scr_arm_pow_available();
  return arm ? scr_arm_pow(x, y) : pow(x, y);
}
#else
#define scr_platform_pow(x, y) pow((x), (y))
#endif

/* Math.pow / the `**` operator — ECMA-262 Number::exponentiate, which C
 * pow() is NOT in three places. C says pow(x, y) is 1.0 whenever x is 1.0
 * (any y, NaN included) and whenever |x| is 1.0 with y infinite; ECMA
 * says NaN for both, and it says NaN for a NaN exponent before it looks
 * at the base at all. The exponent-is-zero rule comes FIRST in both (even
 * NaN ** 0 is 1), so the three guards are ordered exactly as the spec's
 * steps are, and everything after them — the signed zeros, the infinite
 * bases, the negative base with a fractional exponent — C already answers
 * the way ECMA does. */
double scr_math_pow(double x, double y) {
  /* y - y is NaN for NaN and for +-Infinity and 0 for every finite y: one test sends exactly the exponents the spec orders first to the
   * slow arm. C pow(x, +-0) is 1 for every x (NaN included), as the spec says, so a zero exponent needs no test of its own. */
  if (__builtin_expect(y - y != 0.0, 0)) {
    if (isnan(y)) return (double)NAN;                   /* step 1: 1 ** NaN is NaN, not 1 */
    if (fabs(x) == 1.0) return (double)NAN;             /* steps 8/9: (-1) ** +-Infinity, 1 ** +-Infinity */
    return scr_platform_pow(x, y);
  }
  /* V8 answers these two exponents exactly (ieee754::pow keeps fdlibm's): the platform pow is within an ulp of the true value and
   * differs from the exact product x*x and the exact root in a few cases (60.029830358930262 against x*x = 60.029830358930255). */
  if (y == 2.0) return x * x;
  if (y == 0.5 && !signbit(x)) return sqrt(x);
  return scr_platform_pow(x, y);
}

/* Math.pow(x, y) for a finite exponent known at compile time other than 0.5 and 2: the platform pow itself (an out-of-line call, so a C compiler
 * cannot rewrite pow(x, -1) or fold it with its own libm). */
double scr_math_pow_lit(double x, double y) { return scr_platform_pow(x, y); }

/* Math.pow(x, 0.5) with the exponent known at compile time: the exact root for a non-negative base (+0 and +Infinity included), the general
 * rules otherwise (-0 and a negative base). */
double scr_math_pow_half(double x) {
  if (!signbit(x)) return sqrt(x);
  return scr_math_pow(x, 0.5);
}
