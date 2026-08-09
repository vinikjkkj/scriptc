// BigInt.asIntN / BigInt.asUintN -- the value modulo 2^bits, read as two's
// complement or unsigned. It is the operation a 32-bit-half integer
// library is BUILT out of: protobufjs bundles `long`, whose bigint
// constructor is
//
//     Long.fromBigInt = (v, u) => fromBits(Number(BigInt.asIntN(32, v)),
//                                          Number(BigInt.asIntN(32, v >> 32n)), u)
//
// so the whole 64-bit decode path goes through it.
//
// The edges are what make 64-bit worth doing: the sign boundary at
// 2^(bits-1), the wrap at 2^bits, a width of zero, a width WIDER than the
// value (the identity -- answered without building the window, or
// BigInt.asIntN(2**31, 5n) would allocate two gigabits), and the two
// RangeErrors.

function show(label: string, v: bigint): void {
  console.log(label, String(v));
}

// The `long` split, both halves.
const v = 0x0123456789abcdefn;
show("lo", BigInt.asIntN(32, v));
show("hi", BigInt.asIntN(32, v >> 32n));
console.log(Number(BigInt.asIntN(32, v)), Number(BigInt.asIntN(32, v >> 32n)));

// Truncation and sign.
show("asIntN(32, 4294967298n)", BigInt.asIntN(32, 4294967298n));
show("asIntN(32, -1n)", BigInt.asIntN(32, -1n));
show("asUintN(32, -1n)", BigInt.asUintN(32, -1n));
show("asIntN(32, 2147483648n)", BigInt.asIntN(32, 2147483648n));
show("asUintN(32, 2147483648n)", BigInt.asUintN(32, 2147483648n));

// The 64-bit boundary itself.
show("asIntN(64, 2^63)", BigInt.asIntN(64, 2n ** 63n));
show("asIntN(64, 2^63-1)", BigInt.asIntN(64, 2n ** 63n - 1n));
show("asUintN(64, -1n)", BigInt.asUintN(64, -1n));
show("asUintN(64, 2^64)", BigInt.asUintN(64, 2n ** 64n));
show("asIntN(64, -2^63)", BigInt.asIntN(64, -(2n ** 63n)));

// Degenerate and one-bit widths.
show("asIntN(0, 5n)", BigInt.asIntN(0, 5n));
show("asUintN(0, 5n)", BigInt.asUintN(0, 5n));
show("asIntN(1, -1n)", BigInt.asIntN(1, -1n));
show("asUintN(1, -1n)", BigInt.asUintN(1, -1n));
show("asIntN(1, 1n)", BigInt.asIntN(1, 1n));
show("asIntN(7, 0n)", BigInt.asIntN(7, 0n));

// Widths that are not multiples of 32, above and below the limb line.
show("asIntN(96, 2^95+7)", BigInt.asIntN(96, (1n << 95n) + 7n));
show("asUintN(96, -7n)", BigInt.asUintN(96, -7n));
show("asIntN(200, -2^199)", BigInt.asIntN(200, -(2n ** 199n)));
show("asIntN(33, 2^32)", BigInt.asIntN(33, 2n ** 32n));
show("asIntN(31, 2n**31n)", BigInt.asIntN(31, 2n ** 31n));

// ToIndex on the width: NaN is zero, a fraction truncates.
show("asIntN(NaN, 5n)", BigInt.asIntN(NaN, 5n));
show("asIntN(3.7, 5n)", BigInt.asIntN(3.7, 5n));

// A width wider than the value is the identity -- and must not allocate.
show("asIntN(2^31, 5n)", BigInt.asIntN(2 ** 31, 5n));
show("asUintN(2^31, 5n)", BigInt.asUintN(2 ** 31, 5n));
show("asIntN(2^31, -5n)", BigInt.asIntN(2 ** 31, -5n));

// The two RangeErrors, both catchable.
try {
  BigInt.asIntN(-1, 5n);
} catch (e) {
  console.log("negative width:", (e as Error).message);
}
try {
  BigInt.asIntN(1e20, 5n);
} catch (e) {
  console.log("unsafe width:", (e as Error).message);
}
try {
  BigInt.asUintN(2 ** 30 + 1, -1n);
} catch (e) {
  console.log("oversize:", (e as Error).message);
}

// The refusals are values again afterwards -- nothing is poisoned.
show("after", BigInt.asIntN(16, 70000n));
