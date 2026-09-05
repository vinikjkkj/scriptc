// Math.max / Math.min with a MIXED argument list: positional values and
// array spreads in the same call, which is the spelling zapo's companion
// key allocator uses (`Math.max(epoch.currentKeyIndex, ...validIndexes)`).
//
// The lowering folds the list left to right — each spread contributes its
// array's own max/min, each positional contributes itself — and the fold is
// exact rather than approximate because max and min are associative under
// the JS rules: NaN poisons through either operand, and the ±0 ordering
// (+0 above -0 for max, below it for min) is a total order that survives
// regrouping. An EMPTY spread contributes the fold's identity, ∓Infinity,
// so it vanishes exactly as Node has it.
//
// Evaluation order is the other half: JS evaluates arguments left to right
// before any comparison, and the fold nests one level per operand in that
// same order, so a call whose operands have side effects must print its
// trace in argument order.

const xs: number[] = [3, 9, 4];
const ys: number[] = [-2, -7];
const empty: number[] = [];

console.log(Math.max(1, ...xs));
console.log(Math.max(...xs, 100));
console.log(Math.max(1, ...xs, 2, ...ys));
console.log(Math.min(1, ...xs));
console.log(Math.min(...xs, -100));
console.log(Math.min(1, ...xs, 2, ...ys));

// An empty spread is the identity, so the positional wins on both sides.
console.log(Math.max(5, ...empty));
console.log(Math.min(5, ...empty));
console.log(Math.max(...empty, 5));
console.log(Math.min(...empty, 5));

// Only empty spreads: the zero-argument answers, ∓Infinity.
console.log(Math.max(...empty));
console.log(Math.min(...empty));
console.log(Math.max(...empty, ...empty));
console.log(Math.min(...empty, ...empty));

// NaN poisons from either side, positional or spread.
const withNaN: number[] = [1, NaN, 2];
console.log(Math.max(1, ...withNaN));
console.log(Math.min(1, ...withNaN));
console.log(Math.max(NaN, ...xs));
console.log(Math.min(NaN, ...xs));

// ±0: max prefers +0, min prefers -0, and the fold must not lose that.
const negZeros: number[] = [-0, -0];
const posZeros: number[] = [0, 0];
console.log(1 / Math.max(-0, ...negZeros));
console.log(1 / Math.max(0, ...negZeros));
console.log(1 / Math.max(-0, ...posZeros));
console.log(1 / Math.min(0, ...posZeros));
console.log(1 / Math.min(-0, ...posZeros));
console.log(1 / Math.min(0, ...negZeros));

// Infinities mixed in.
console.log(Math.max(1, ...[Infinity, 2]));
console.log(Math.min(1, ...[-Infinity, 2]));
console.log(Math.max(-Infinity, ...empty));
console.log(Math.min(Infinity, ...empty));

// Evaluation order: argument order, left to right, before any compare.
const trace: string[] = [];
function tap(label: string, value: number): number {
  trace.push(label);
  return value;
}
function tapArr(label: string, value: number[]): number[] {
  trace.push(label);
  return value;
}
console.log(Math.max(tap("a", 1), ...tapArr("b", [7]), tap("c", 3), ...tapArr("d", [2])));
console.log(trace.join(","));

// A single argument list built from one spread only still answers the
// array fold (the pre-existing form, unchanged).
console.log(Math.max(...xs));
console.log(Math.min(...ys));

// The result flows into arithmetic like any number.
console.log(Math.max(0, ...xs) + 1);
console.log(Math.min(0, ...ys) - 1);

// The zapo shape itself: a high-water mark folded against a live list.
function nextIndex(current: number, valid: number[]): number {
  return Math.max(current, ...valid) + 1;
}
console.log(nextIndex(0, [0, 1, 5]));
console.log(nextIndex(9, [0, 1, 5]));
console.log(nextIndex(3, []));
