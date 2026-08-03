// A const LOOKUP TABLE read with a COMPUTED index.
//
//   const T = ['a', 'b', 'c'] as const
//   for (let i = 0; i < T.length; i++) map.set(T[i], i)
//
// `as const` makes the declared type a TUPLE, which maps to a fixed-shape
// record -- and a record has no slot a computed index can reach, so the
// read fenced. The value is an array either way (`as const` is a
// type-level assertion), and with one shared element type the tuple and
// the array describe the same thing, so a uniform table BINDS as an array.
//
// That alone would only move the fence: a parameter that spells the tuple
// still maps to a record, and passing the table to it would stop
// compiling. So the other direction lands with it -- an array flowing into
// a uniform tuple slot is the positional copy, through an interned helper
// so the source is evaluated once. Both halves are exercised below;
// keeping only the first would trade one gap for another.
const TOKENS = ["alpha", "beta", "gamma", "delta"] as const;

// The read that motivated it: a computed index, and .length driving it.
const index = new Map<string, number>();
for (let i = 0; i < TOKENS.length; i += 1) {
  index.set(TOKENS[i], i + 1);
}
console.log(index.get("alpha"), index.get("gamma"), index.get("absent"));
console.log(TOKENS.length, TOKENS[0], TOKENS[3]);

// Object.freeze around it is the same table wearing the runtime no-op the
// source uses to say `readonly` out loud.
const FROZEN = Object.freeze(["one", "two", "three"] as const);
let joined = "";
for (let i = 0; i < FROZEN.length; i += 1) joined += `${FROZEN[i]}/`;
console.log(joined, FROZEN.length);

// The array methods a tuple has no lowering for now work on the table.
console.log(TOKENS.join("-"));
console.log(TOKENS.filter((t) => t.length === 5).join(","));
console.log(TOKENS.indexOf("beta"), TOKENS.includes("delta"));

// The other direction: a parameter spelling the TUPLE still receives it.
function widthOf(t: readonly ["alpha", "beta", "gamma", "delta"]): string {
  return `${t[0]}|${t[3]}`;
}
console.log(widthOf(TOKENS));

// A numeric table, to show the element type is not special.
const WEIGHTS = [1.5, 2.5, 3.5] as const;
let total = 0;
for (let i = 0; i < WEIGHTS.length; i += 1) total += WEIGHTS[i];
console.log(total);

function sumTuple(t: readonly [1.5, 2.5, 3.5]): number {
  return t[0] + t[1] + t[2];
}
console.log(sumTuple(WEIGHTS));

// A NON-uniform tuple keeps its record: mixed element types have no single
// array to be, and the literal index reads the field as before.
const PAIR = ["count", 7] as const;
console.log(PAIR[0], PAIR[1]);
