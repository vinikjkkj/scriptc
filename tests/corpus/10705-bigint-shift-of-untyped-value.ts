// The shape of a 64-bit split over an untyped value: BigInt.asIntN over
// `value >> BigInt(32)` with value an untyped BigInt or number-free box.
function split(value: any, unsigned: boolean): number[] {
  const low = Number(BigInt.asIntN(32, value))
  const high = Number(BigInt.asIntN(32, value >> BigInt(32)))
  return [low, high, unsigned ? 1 : 0]
}
console.log(split(5000000000n, false))
console.log(split(-1n, true))
console.log(split(1n << 40n, false))
console.log(split(0n, true))
