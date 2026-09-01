// A 64-bit field backend for monocypher's arithmetic modulo 2^255 - 19.
//
// WHY THIS FILE EXISTS
// --------------------
// The vendored monocypher.c carries SUPERCOP ref10's portable field
// representation: `typedef i32 fe[10]`, ten signed limbs of alternating
// 26/25 bits, every product accumulated in i64. That is the representation
// you must use when the compiler has no 128-bit integer. This project
// compiles through `zig cc -target x86_64-windows-gnu`, where it does.
//
// Measured on that exact toolchain and target (`-O2`, the option set
// packages/compiler/src/backend/cc.ts gives every runtime TU), dependent
// chains of 2,000,000 operations, __rdtscp, three reps:
//
//     fe_mul   ref10 10x25.5-bit  129.8 - 153.4 cyc      (median 133.1)
//     fe_mul   this  5x51-bit      69.8 -  77.5 cyc      (median  70.1)   1.90x
//     fe_sq    ref10 10x25.5-bit   91.0 -  97.4 cyc      (median  93.5)
//     fe_sq    this  5x51-bit      43.5 -  44.3 cyc      (median  43.6)   2.14x
//
// and callgrind (deterministic Ir, no timing floor) puts field multiply and
// square at 90.6% of `crypto_x25519`, 72.2% of `crypto_ed25519_key_pair`,
// 68.8% of `crypto_ed25519_sign` and 91.7% of `crypto_ed25519_check`, so
// this layer is nearly the whole cost of every public-key operation the
// runtime performs.
//
// THE REPRESENTATION, AND THE ONE INVARIANT THAT MAKES IT SAFE
// ------------------------------------------------------------
// `fe` is five UNSIGNED 51-bit limbs: v = h[0] + h[1]*2^51 + ... + h[4]*2^204.
// ref10's limbs are SIGNED and its higher-level code leans on that: `fe_add`
// and `fe_sub` there do not carry, and each caller is responsible for not
// stacking enough of them to break `fe_mul`'s |limb| < 1.65*2^26
// precondition. Reproducing that discipline in unsigned form means auditing
// every add/sub chain in ge_add, ge_madd, ge_double, scalarmult, invsqrt and
// the elligator paths for magnitude growth — which is precisely the kind of
// analysis that produces an implementation that is right on every test and
// wrong on one input in 2^40.
//
// So this backend does not reproduce it. Instead EVERY operation here
// re-establishes one invariant:
//
//     after any fe_* producer, h[i] < 2^51 + 2 for all i
//
// `fe_add`, `fe_sub`, `fe_neg`, `fe_mul_small`, `fe_mul` and `fe_sq` all end
// in a carry chain; `fe_0`, `fe_1`, `fe_copy`, `fe_cswap`, `fe_ccopy` and
// `fe_frombytes_mask` preserve it by construction. The invariant is therefore
// a local property of this file, provable by reading this file alone, and no
// caller can violate it. The cost is ~10 integer ops added to `fe_add` and
// `fe_sub`, against the ~70 cycles of the multiply they protect.
//
// With limbs < 2^51 + 2, a `fe_mul` column is at most five terms of
// f*g*19 < 2^51.01 * 2^51.01 * 19 < 2^106.4, so the u128 accumulator peaks
// below 2^109 — more than 19 bits of headroom under 2^128.
//
// `fe_sub` and `fe_neg` add 2p = 2^256 - 38 before subtracting, in the
// standard split {2^52-38, 2^52-2, 2^52-2, 2^52-2, 2^52-2}, so no limb ever
// borrows. That split is checked, not asserted: it sums to exactly 2*(2^255-19).
//
// CONSTANT TIME
// -------------
// Every routine here is branch-free on secret data. The single branch is in
// `fe_mul_small` on the sign of its `i32` multiplier, which is a literal at
// every call site in monocypher.c (2, -2, 121666) and never secret.
//
// SELECTION
// ---------
// monocypher.c includes this file in place of its own field block when
// SCR_MONOCYPHER_FE64 is defined. Everything above the field layer —
// fe_isodd, fe_isequal, fe_invert, invsqrt, ge_*, scalarmult,
// crypto_x25519, crypto_eddsa_* — is untouched and representation-agnostic:
// nothing outside this block ever indexes an `fe`.

typedef unsigned __int128 u128;

// field element
typedef u64 fe_limb;
typedef fe_limb fe[5];

#define FE_MASK51 0x7ffffffffffffULL

// field constants, converted from ref10's ten-limb encoding
// (v = sum h[i] * 2^ceil(25.5*i)) and reduced mod 2^255-19.
//
// fe_one      : 1
// sqrtm1      : sqrt(-1)
// d           :     -121665 / 121666
// D2          : 2 * -121665 / 121666
// lop_x, lop_y: low order point in Edwards coordinates
// ufactor     : -sqrt(-1) * 2
// A2          : 486662^2  (A squared)
static const fe fe_one  = {0x0000000000001ULL, 0x0000000000000ULL, 0x0000000000000ULL,
                           0x0000000000000ULL, 0x0000000000000ULL};
static const fe sqrtm1  = {0x61b274a0ea0b0ULL, 0x0d5a5fc8f189dULL, 0x7ef5e9cbd0c60ULL,
                           0x78595a6804c9eULL, 0x2b8324804fc1dULL};
static const fe d       = {0x34dca135978a3ULL, 0x1a8283b156ebdULL, 0x5e7a26001c029ULL,
                           0x739c663a03cbbULL, 0x52036cee2b6ffULL};
static const fe D2      = {0x69b9426b2f159ULL, 0x35050762add7aULL, 0x3cf44c0038052ULL,
                           0x6738cc7407977ULL, 0x2406d9dc56dffULL};
static const fe lop_x   = {0x14646c545d14aULL, 0x6027cbc471bd4ULL, 0x3792aed7064f1ULL,
                           0x5147499cc991cULL, 0x1fd5b9a006394ULL};
static const fe lop_y   = {0x7b2c28f95e826ULL, 0x6513e9868b604ULL, 0x6b37f57c263bfULL,
                           0x4589c99e36982ULL, 0x05fc536d88023ULL};
static const fe ufactor = {0x3c9b16be2be8dULL, 0x654b406e1cec4ULL, 0x02142c685e73fULL,
                           0x0f4d4b2ff66c2ULL, 0x28f9b6ff607c4ULL};
static const fe A2      = {0x0003724c21c24ULL, 0x0000000000000ULL, 0x0000000000000ULL,
                           0x0000000000000ULL, 0x0000000000000ULL};

// The invariant-restoring carry chain. Accepts any t[i] < 2^63 and leaves
// every limb below 2^51 + 2. Two passes over limb 0 are needed because the
// wrap of the top limb re-enters at the bottom multiplied by 19.
#define FE_CARRY51 \
	u64 fc; \
	fc = t0 >> 51;  t0 &= FE_MASK51;  t1 += fc; \
	fc = t1 >> 51;  t1 &= FE_MASK51;  t2 += fc; \
	fc = t2 >> 51;  t2 &= FE_MASK51;  t3 += fc; \
	fc = t3 >> 51;  t3 &= FE_MASK51;  t4 += fc; \
	fc = t4 >> 51;  t4 &= FE_MASK51;  t0 += fc * 19; \
	fc = t0 >> 51;  t0 &= FE_MASK51;  t1 += fc; \
	h[0] = t0;  h[1] = t1;  h[2] = t2;  h[3] = t3;  h[4] = t4

static void fe_0(fe h) {           ZERO(h  , 5); }
static void fe_1(fe h) { h[0] = 1; ZERO(h+1, 4); }

static void fe_copy(fe h, const fe f) { FOR (i, 0, 5) h[i] = f[i]; }

// h = 2p - f, then carried. 2p never borrows because every limb of 2p
// exceeds the invariant bound 2^51 + 2.
static void fe_neg(fe h, const fe f)
{
	u64 t0 = 0xFFFFFFFFFFFDAULL - f[0];
	u64 t1 = 0xFFFFFFFFFFFFEULL - f[1];
	u64 t2 = 0xFFFFFFFFFFFFEULL - f[2];
	u64 t3 = 0xFFFFFFFFFFFFEULL - f[3];
	u64 t4 = 0xFFFFFFFFFFFFEULL - f[4];
	FE_CARRY51;
}

static void fe_add(fe h, const fe f, const fe g)
{
	u64 t0 = f[0] + g[0];  u64 t1 = f[1] + g[1];  u64 t2 = f[2] + g[2];
	u64 t3 = f[3] + g[3];  u64 t4 = f[4] + g[4];
	FE_CARRY51;
}

static void fe_sub(fe h, const fe f, const fe g)
{
	u64 t0 = f[0] + 0xFFFFFFFFFFFDAULL - g[0];
	u64 t1 = f[1] + 0xFFFFFFFFFFFFEULL - g[1];
	u64 t2 = f[2] + 0xFFFFFFFFFFFFEULL - g[2];
	u64 t3 = f[3] + 0xFFFFFFFFFFFFEULL - g[3];
	u64 t4 = f[4] + 0xFFFFFFFFFFFFEULL - g[4];
	FE_CARRY51;
}

static void fe_cswap(fe f, fe g, int b)
{
	u64 mask = ~((u64)b - 1); // b = 1 -> all ones, b = 0 -> all zeroes
	FOR (i, 0, 5) {
		u64 x = (f[i] ^ g[i]) & mask;
		f[i] = f[i] ^ x;
		g[i] = g[i] ^ x;
	}
}

static void fe_ccopy(fe f, const fe g, int b)
{
	u64 mask = ~((u64)b - 1);
	FOR (i, 0, 5) {
		u64 x = (f[i] ^ g[i]) & mask;
		f[i] = f[i] ^ x;
	}
}

// Decodes a field element from a byte buffer.
// mask specifies how many bits we ignore.
// Traditionally we ignore 1. It's useful for EdDSA,
// which uses that bit to denote the sign of x.
// Elligator however uses positive representatives,
// which means ignoring 2 bits instead.
//
// The result is NOT reduced mod p — a 255-bit input stays a 255-bit value,
// exactly as ref10's version does. Every limb is below 2^51, so the
// invariant holds and fe_mul accepts it; fe_tobytes reduces fully.
static void fe_frombytes_mask(fe h, const u8 s[32], unsigned nb_mask)
{
	u64 x0 = load64_le(s     );
	u64 x1 = load64_le(s +  8);
	u64 x2 = load64_le(s + 16);
	u64 x3 = load64_le(s + 24) & (~(u64)0 >> nb_mask);
	h[0] =   x0                      & FE_MASK51;
	h[1] = ((x0 >> 51) | (x1 << 13)) & FE_MASK51;
	h[2] = ((x1 >> 38) | (x2 << 26)) & FE_MASK51;
	h[3] = ((x2 >> 25) | (x3 << 39)) & FE_MASK51;
	h[4] =  (x3 >> 12)               & FE_MASK51;
}

static void fe_frombytes(fe h, const u8 s[32])
{
	fe_frombytes_mask(h, s, 1);
}

// Fully reduces h mod 2^255-19 and serialises it little-endian.
// Precondition: the file invariant, h[i] < 2^51 + 2.
static void fe_tobytes(u8 s[32], const fe h)
{
	u64 t0 = h[0], t1 = h[1], t2 = h[2], t3 = h[3], t4 = h[4], c;

	// Bring every limb strictly below 2^51 (value now < 2^255 + 19).
	c = t0 >> 51;  t0 &= FE_MASK51;  t1 += c;
	c = t1 >> 51;  t1 &= FE_MASK51;  t2 += c;
	c = t2 >> 51;  t2 &= FE_MASK51;  t3 += c;
	c = t3 >> 51;  t3 &= FE_MASK51;  t4 += c;
	c = t4 >> 51;  t4 &= FE_MASK51;  t0 += c * 19;
	c = t0 >> 51;  t0 &= FE_MASK51;  t1 += c;
	c = t1 >> 51;  t1 &= FE_MASK51;  t2 += c;

	// q = 1 iff t >= p. Computed by adding 19 and watching the top carry,
	// with no branch and no comparison on the value itself.
	c = (t0 + 19) >> 51;
	c = (t1 + c ) >> 51;
	c = (t2 + c ) >> 51;
	c = (t3 + c ) >> 51;
	c = (t4 + c ) >> 51;

	// Adding q * 19 and dropping the 2^255 bit subtracts q * p.
	t0 += 19 * c;
	t1 += t0 >> 51;  t0 &= FE_MASK51;
	t2 += t1 >> 51;  t1 &= FE_MASK51;
	t3 += t2 >> 51;  t2 &= FE_MASK51;
	t4 += t3 >> 51;  t3 &= FE_MASK51;
	t4 &= FE_MASK51;

	store64_le(s     ,  t0        | (t1 << 51));
	store64_le(s +  8, (t1 >> 13) | (t2 << 38));
	store64_le(s + 16, (t2 >> 26) | (t3 << 25));
	store64_le(s + 24, (t3 >> 39) | (t4 << 12));
}

// h = f * g, g a small NON-NEGATIVE multiplier below 2^31.
static void fe_mul_small_pos(fe h, const fe f, u64 g)
{
	u128 p0 = (u128)f[0] * g;  u128 p1 = (u128)f[1] * g;
	u128 p2 = (u128)f[2] * g;  u128 p3 = (u128)f[3] * g;
	u128 p4 = (u128)f[4] * g;
	u64 t0, t1, t2, t3, t4;
	t0 = (u64)p0 & FE_MASK51;  p1 += (u64)(p0 >> 51);
	t1 = (u64)p1 & FE_MASK51;  p2 += (u64)(p1 >> 51);
	t2 = (u64)p2 & FE_MASK51;  p3 += (u64)(p2 >> 51);
	t3 = (u64)p3 & FE_MASK51;  p4 += (u64)(p3 >> 51);
	t4 = (u64)p4 & FE_MASK51;  t0 += (u64)(p4 >> 51) * 19;
	// t0 < 2^51 + 19*2^31; one more pass restores the invariant.
	{ FE_CARRY51; }
}

// The multiplier is a literal at every call site (2, -2, 121666); its sign
// is public, so this branch leaks nothing.
static void fe_mul_small(fe h, const fe f, i32 g)
{
	if (g < 0) {
		fe t;
		fe_mul_small_pos(t, f, (u64)(-(i64)g));
		fe_neg(h, t);
		WIPE_BUFFER(t);
	} else {
		fe_mul_small_pos(h, f, (u64)(i64)g);
	}
}

// h = f * g mod 2^255-19.
// Precondition: the file invariant on both inputs, f[i], g[i] < 2^51 + 2.
// Each column is five terms below 2^51.01 * 2^51.01 * 19 < 2^106.4, so the
// u128 accumulators stay under 2^109.
static void fe_mul(fe h, const fe f, const fe g)
{
	u64 f0 = f[0], f1 = f[1], f2 = f[2], f3 = f[3], f4 = f[4];
	u64 g0 = g[0], g1 = g[1], g2 = g[2], g3 = g[3], g4 = g[4];
	u64 g1_19 = 19 * g1, g2_19 = 19 * g2, g3_19 = 19 * g3, g4_19 = 19 * g4;

	u128 p0 = (u128)f0*g0 + (u128)f1*g4_19 + (u128)f2*g3_19 + (u128)f3*g2_19 + (u128)f4*g1_19;
	u128 p1 = (u128)f0*g1 + (u128)f1*g0    + (u128)f2*g4_19 + (u128)f3*g3_19 + (u128)f4*g2_19;
	u128 p2 = (u128)f0*g2 + (u128)f1*g1    + (u128)f2*g0    + (u128)f3*g4_19 + (u128)f4*g3_19;
	u128 p3 = (u128)f0*g3 + (u128)f1*g2    + (u128)f2*g1    + (u128)f3*g0    + (u128)f4*g4_19;
	u128 p4 = (u128)f0*g4 + (u128)f1*g3    + (u128)f2*g2    + (u128)f3*g1    + (u128)f4*g0;

	u64 t0, t1, t2, t3, t4;
	t0 = (u64)p0 & FE_MASK51;  p1 += (u64)(p0 >> 51);
	t1 = (u64)p1 & FE_MASK51;  p2 += (u64)(p1 >> 51);
	t2 = (u64)p2 & FE_MASK51;  p3 += (u64)(p2 >> 51);
	t3 = (u64)p3 & FE_MASK51;  p4 += (u64)(p3 >> 51);
	t4 = (u64)p4 & FE_MASK51;  t0 += (u64)(p4 >> 51) * 19;
	{ FE_CARRY51; }
}

// h = f^2 mod 2^255-19. Same preconditions as fe_mul; the off-diagonal
// terms are pre-doubled, and the terms above the diagonal fold down by 19.
static void fe_sq(fe h, const fe f)
{
	u64 f0 = f[0], f1 = f[1], f2 = f[2], f3 = f[3], f4 = f[4];
	u64 f0_2 = f0 * 2, f1_2 = f1 * 2;
	u64 f1_38 = f1 * 38, f2_38 = f2 * 38, f3_38 = f3 * 38;
	u64 f3_19 = f3 * 19, f4_19 = f4 * 19;

	u128 p0 = (u128)f0*f0   + (u128)f1_38*f4 + (u128)f2_38*f3;
	u128 p1 = (u128)f0_2*f1 + (u128)f2_38*f4 + (u128)f3_19*f3;
	u128 p2 = (u128)f0_2*f2 + (u128)f1*f1    + (u128)f3_38*f4;
	u128 p3 = (u128)f0_2*f3 + (u128)f1_2*f2  + (u128)f4_19*f4;
	u128 p4 = (u128)f0_2*f4 + (u128)f1_2*f3  + (u128)f2*f2;

	u64 t0, t1, t2, t3, t4;
	t0 = (u64)p0 & FE_MASK51;  p1 += (u64)(p0 >> 51);
	t1 = (u64)p1 & FE_MASK51;  p2 += (u64)(p1 >> 51);
	t2 = (u64)p2 & FE_MASK51;  p3 += (u64)(p2 >> 51);
	t3 = (u64)p3 & FE_MASK51;  p4 += (u64)(p3 >> 51);
	t4 = (u64)p4 & FE_MASK51;  t0 += (u64)(p4 >> 51) * 19;
	{ FE_CARRY51; }
}
