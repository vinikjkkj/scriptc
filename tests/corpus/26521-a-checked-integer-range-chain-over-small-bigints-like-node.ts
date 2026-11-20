function toInteger(value: unknown): bigint {
  switch (typeof value) {
    case 'bigint': return value
    case 'boolean': return value ? 1n : 0n
    case 'number':
      if (!Number.isSafeInteger(value)) throw new RangeError("unsafe")
      return BigInt(value)
    default: throw new TypeError("no")
  }
}
function checkedInteger(value: unknown, bytes: number, unsigned: boolean): bigint {
  const bits = BigInt(bytes * 8)
  const n = toInteger(value)
  const min = unsigned ? 0n : -(1n << (bits - 1n))
  const max = unsigned ? (1n << bits) - 1n : (1n << (bits - 1n)) - 1n
  if (n < min || n > max) throw new RangeError(`out of range: ${n} is not within ${min}..${max}`)
  return n
}
function integerEncoder(bytes: number): (value: unknown, unsigned: boolean) => number {
  return (value, unsigned) => {
    const wire = BigInt.asUintN(bytes * 8, checkedInteger(value, bytes, unsigned))
    return bytes === 8 ? Number(wire) : Number(wire)
  }
}
const e4 = integerEncoder(4), e8 = integerEncoder(8)
let acc = 0
for (let i = 0; i < 200000; i++) { acc += e4(i, false) + e8(i * 3, true) + e4(-i, false) }
console.log(acc)
console.log(e8(2 ** 53 - 1, false), e4(-2147483648, false), e8(9007199254740991, true), e4(4294967295, true))
for (const v of [2147483648, -2147483649, 4294967296]) { try { e4(v, v > 0 && v === 4294967296 ? true : false) } catch (e) { console.log((e as Error).message) } }
