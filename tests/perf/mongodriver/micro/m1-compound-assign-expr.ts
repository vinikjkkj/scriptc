// bson long.ts:983,1005,1027 shape: a compound assignment used as an EXPRESSION,
// then compared. The compiler reports SC1043 "comparing non-number, non-string
// values" here; the construct is an assignment-expression, not a comparison.
export function shiftLeft(numBits: number): number {
  if ((numBits &= 63) === 0) return 0
  return numBits
}
console.log(shiftLeft(70))
