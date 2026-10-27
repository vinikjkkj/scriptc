// A shift of an unknown BigInt by a BigInt built from a Number, as in the
// `long` package's fromBigInt: the high word of a 64-bit value.
function high(value: any): number {
  return Number(BigInt.asIntN(32, value >> BigInt(32)));
}
function low(value: any): number {
  return Number(BigInt.asIntN(32, value));
}
console.log(high(5000000000n), low(5000000000n), high(-1n), low(-1n), high(1n << 40n), high(0n));
