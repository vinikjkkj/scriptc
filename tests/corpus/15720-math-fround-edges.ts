// Math.fround (ECMA-262 21.3.2.17): the nearest binary32 value to the argument,
// ties to even, returned as a double. Probed at the edges of the format: NaN and
// the infinities, the sign of zero, the least subnormal 2^-149 and the halfway
// point below it (2^-150, which ties to even and rounds to zero), the overflow
// midpoint 2^128 - 2^103 (ties to even, so it overflows to Infinity), the
// largest finite float, halfway cases that round to the even neighbour
// (1 + 2^-24 is 1, 1 + 3 * 2^-24 is 1 + 2^-22), and ordinary decimals.
const vals: number[] = [
  NaN, 0, -0, Infinity, -Infinity,
  1, -1, 0.1, -0.1, 1.1, -1.1, 16777217, 16777219, 16777215.5,
  Math.pow(2, -149), Math.pow(2, -150), Math.pow(2, -150) * 1.0000001, Math.pow(2, -151),
  -Math.pow(2, -150), 1.4e-45, 3e-45, 1.2e-38, 1.17549435e-38,
  3.4028234663852886e38, 3.4028235e38, 3.4028235677973366e38, 3.5e38, 1e39, -1e39,
  Number.MAX_VALUE, Number.MIN_VALUE, Number.EPSILON,
  1 + Math.pow(2, -24), 1 + 3 * Math.pow(2, -24), 1 + Math.pow(2, -23), 1 + Math.pow(2, -53),
];
for (const v of vals) {
  const f = Math.fround(v);
  console.log(v, f, Object.is(f, -0), Object.is(f, v), f === f, 1 / f);
}
for (const v of vals) {
  const once = Math.fround(v);
  console.log("idempotent", Object.is(Math.fround(once), once));
}
console.log("sign of zero", Object.is(Math.fround(-0), -0), Object.is(Math.fround(0), 0));
console.log("nan", Math.fround(NaN) !== Math.fround(NaN), Object.is(Math.fround(NaN), NaN));
console.log("infinities", Math.fround(Infinity), Math.fround(-Infinity));
console.log("expressions", Math.fround(0.1) + Math.fround(0.2), Math.fround(1 / 3) * 3);
