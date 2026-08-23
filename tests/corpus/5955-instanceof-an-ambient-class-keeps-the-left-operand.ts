// @exit: 1
// The other half of 5954: when the LEFT operand of an ambient `instanceof`
// has effects, JavaScript performs them BEFORE evaluating the right one
// and dying there. So the counter must reach 1 and its line must print.
//
// On the compiler as it stood before that fix, both backends REFUSED this shape at build time
// (`SC1090: statically-decided 'instanceof' on computed operands`), so
// this cell is TRAP->MATCH, not WRONG->MATCH — it was loud, and it is
// recorded here only so the ordering can never regress into "drop the
// left operand because the answer is a throw anyway".

declare class Amb {
  readonly y: number;
}

class Real {
  v = 1;
}

let lhsRuns = 0;
function makeReal(): Real {
  lhsRuns = lhsRuns + 1;
  console.log("lhs ran", lhsRuns);
  return new Real();
}

console.log("before");

const verdict = makeReal() instanceof Amb;

console.log("never", verdict, lhsRuns);
