// scriptc: X25519 over a four-limb 64-bit field (radix 2^64), used by crypto_x25519 only.
//
// WHY: callgrind of the compiled mysql/redis programs puts the X25519 scalar multiplication at ~23-32% of all instructions. The five-limb
// 2^51 field of monocypher-fe64.h needs 25 multiplies (+5 by 19) per field multiply; four 64-bit limbs need 16 (+4 by 38) with the
// carries in the 128-bit accumulator, and when the CPU has BMI2 the compiler turns the 64x64->128 products into MULX. Ed25519 and every
// other user of `fe` are untouched: this file has its own element type and its own ladder, and crypto_x25519 is the only caller.
//
// THE REPRESENTATION: x4fe = four unsigned 64-bit limbs holding any value below 2^256 that is congruent to the element modulo
// p = 2^255-19. Nothing needs to be canonical until x4_tobytes. Every routine re-establishes "< 2^256" (the wrap-around folds use
// 2^256 == 38 mod p), and the second fold of every carry is bounded so the last addition cannot carry (the value left after a carry out
// of 2^256 is below 2^12, which is stated at each fold). Every routine is branch-free on secret data (masks, no data-dependent branch).
//
// SELECTION: x86-64 with clang only (measured there; gcc's 128-bit codegen made it slower, aarch64 is unmeasured, so both keep the
// five-limb field). The ladder is compiled twice, plain and with target("bmi2"); the CPU decides at the first call (cpuid leaf 7).
// -DSCR_NO_X25519_4X64 turns it off.
#include <stdint.h>
#include <string.h>
#if defined(__clang__) && defined(__x86_64__) && defined(__SIZEOF_INT128__) && !defined(SCR_NO_X25519_4X64)
#define SCR_X25519_4X64 1
#include <cpuid.h>
#define X4NOINLINE __attribute__((noinline))
typedef unsigned __int128 x4u128;
typedef struct { uint64_t v[4]; } x4fe; /* value < 2^256, congruent mod p */
   /* value < 2^256, congruent mod p */

#define X4SFX plain
#define X4TGT
#include "monocypher-x25519-64-body.h"
#undef X4SFX
#undef X4TGT
#define X4SFX bmi2
#define X4TGT __attribute__((target("bmi2")))
#include "monocypher-x25519-64-body.h"
#undef X4SFX
#undef X4TGT
static int x4_has_bmi2 = -1;
static void scr_x25519_4x64(uint8_t q[32], const uint8_t s[32], const uint8_t p[32]) {
  int b = x4_has_bmi2;
  if (b < 0) {
    unsigned a = 0, bx = 0, c = 0, d = 0;
    b = __get_cpuid_count(7, 0, &a, &bx, &c, &d) ? (int)((bx >> 8) & 1) : 0;
    x4_has_bmi2 = b;
  }
  if (b) x4_ladder_bmi2(q, s, p); else x4_ladder_plain(q, s, p);
}
#endif // SCR_X25519_4X64
