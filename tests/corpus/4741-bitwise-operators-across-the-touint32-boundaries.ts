// The bitwise operators over the values where ToUint32 stops being a cast.
//
// Every one of `& | ^ << >> >>> ~` is ToUint32 twice and the 32 bits back
// out again, and ToUint32 is only "truncate and take the low 32 bits" while
// the operand fits an int64. This program walks the places where that stops
// being true and where the spec's steps stop agreeing with a cast:
//
//   +-2^31, +-2^32          the sign wrap and the modulus itself
//   +-2^32 +- 1             either side of the modulus, where a fast path
//                           guarded with >= instead of > would still be
//                           right (it is: conversion to an unsigned type is
//                           already modulo 2^32) and where one guarded at
//                           the wrong magnitude would not be
//   2^53, 2^63, 2^64, 1e19  past the exactly-representable integers and past
//                           the int64 range, where only fmod is left
//   negative non-integers   trunc() rounds toward ZERO; floor() does not,
//                           and the two disagree for every one of them
//   NaN, +-Infinity         ToUint32 answers 0 for all three
//   -0                      answers 0, and must not answer -0
//
// It asserts nothing on its own: the corpus's whole contract is that the
// compiled output is byte-identical to Node's, so Node is the oracle for
// every line below. It does NOT fail on base - nothing is broken on base.
// It exists because the runtime's ToUint32 now has a fast path for
// |d| < 2^32 and a slow path for everything else, and the boundary between
// them is exactly the set of values printed here.
const vals: number[] = [
  0, -0, 1, -1, 0.5, -0.5, 1.5, -1.5, 2.75, -2.75,
  2147483647, 2147483648, 2147483649, -2147483647, -2147483648, -2147483649,
  4294967294, 4294967295, 4294967296, 4294967297,
  -4294967294, -4294967295, -4294967296, -4294967297,
  4294967295.5, -4294967295.5, 4294967296.5, -4294967296.5,
  8589934592, -8589934592, 8589934593, -8589934593,
  9007199254740991, -9007199254740991,
  9223372036854775808, -9223372036854775808,
  18446744073709551616, -18446744073709551616,
  1e19, -1e19, 1e21, -1e21, 1e300, -1e300,
  0.9999999999, -0.9999999999, 1e-300, -1e-300,
  NaN, Infinity, -Infinity,
]

const masks: number[] = [0, 1, 255, 1023, 65535, -1, 2147483647, -2147483648, 4294967295]

for (let i = 0; i < vals.length; i++) {
  const v = vals[i]
  let line = "v=" + String(v)
  line += " ~=" + String(~v)
  line += " >>>0=" + String(v >>> 0)
  line += " |0=" + String(v | 0)
  for (let j = 0; j < masks.length; j++) {
    const m = masks[j]
    line += " [" + String(m) + "]"
    line += " &=" + String(v & m)
    line += " |=" + String(v | m)
    line += " ^=" + String(v ^ m)
  }
  console.log(line)
}

// Shift counts are ToUint32'd too, then masked to 5 bits, so the same
// boundary set has to be walked on the RIGHT of a shift as well.
for (let i = 0; i < vals.length; i++) {
  const v = vals[i]
  let line = "s=" + String(v)
  for (let k = 0; k < 8; k++) {
    line += " <<" + String(k) + "=" + String(1 << (v + k))
    line += " >>" + String(k) + "=" + String(-1 >> (v + k))
    line += " >>>" + String(k) + "=" + String(-1 >>> (v + k))
  }
  console.log(line)
}

// And the operators applied to values the fast path produces, so a wrong
// wrap shows up as a wrong FOLLOW-ON rather than only as a wrong digit.
let acc = 0
for (let i = 0; i < vals.length; i++) {
  acc = (acc ^ (vals[i] & 4294967295)) >>> 0
  acc = (acc + (vals[i] | 0)) | 0
}
console.log("acc=" + String(acc))
