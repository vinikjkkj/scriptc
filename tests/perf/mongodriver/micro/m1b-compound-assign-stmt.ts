// The control for m1: the SAME compound assignment as a STATEMENT, compared
// separately. If this compiles and m1 does not, the construct is the
// assignment-in-expression-position, not the comparison.
export function shiftLeft(numBits: number): number {
  numBits &= 63
  if (numBits === 0) return 0
  return numBits
}
console.log(shiftLeft(70))
