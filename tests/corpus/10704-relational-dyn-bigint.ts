// Relational comparison with a BigInt operand: exact against numbers (no
// rounding through a double), order against bigints, and StringToBigInt
// against strings where a string that is no BigInt answers false.
const big: any = 5000000000n
const small: any = 3
const nan: any = NaN
const str: any = '5000000000'
const junk: any = 'abc'
console.log(big >= small, small < big, big < 6000000000n, big <= 5000000000)
console.log(big > 4999999999.5, big < 5000000000.5, big < nan, nan >= big)
console.log(big < str, big <= str, big > ('5000000001' as any), ('4' as any) < big)
console.log(big < junk, junk > big, (true as any) < (2n as any), (' 12 ' as any) < (13n as any))
console.log((1n as any) == 1, (1n as any) == (1 as any), (1n as any) === 1n)
