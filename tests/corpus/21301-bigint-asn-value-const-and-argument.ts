// The static value held in a const, called through the const, and passed to
// a parameter typed with the value's own signature (any, any) => bigint.
const u: boolean = true;
const asBigIntN = u ? BigInt.asUintN : BigInt.asIntN;
console.log(String(asBigIntN(64, -5n)), String(asBigIntN(8, 255n)));
const direct = BigInt.asIntN;
console.log(String(direct(8, 255n)), String(direct(64, -1n)), String(direct(0, 9n)));
function apply(fn: (bits: any, v: any) => bigint, bits: any, v: any): bigint {
  return fn(bits, v);
}
console.log(String(apply(BigInt.asUintN, 8, -1n)), String(apply(BigInt.asIntN, 8, 255n)));
function fromHalves(hi: bigint, lo: bigint): bigint {
  return (BigInt.asIntN(32, hi) << 32n) | BigInt.asUintN(32, lo);
}
console.log(String(fromHalves(-1n, 5n)), String(fromHalves(2n, 0xffffffffn)));
