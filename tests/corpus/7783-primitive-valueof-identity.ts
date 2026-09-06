// `x.valueOf()` on a primitive -- the identity read Node's
// Number/String/Boolean prototypes answer, and the spelling bson's
// `Double` constructor uses to unbox a `Number` wrapper
// (`value = value.valueOf()` behind an `instanceof Number` guard).
//
// The dyn path already dispatched this name at runtime (the runtime's
// object-prototype method row: "one no receiver kind overrides
// observably"), so a STATICALLY typed receiver was the one spelling that
// refused. A symbol receiver already had the identity read too.

const n = 42;
console.log(n.valueOf(), n.valueOf() + 1);

const s = "hi";
console.log(s.valueOf(), s.valueOf().length);

const b = true;
console.log(b.valueOf(), b.valueOf() === true);

// Through a binding whose value is computed, not a literal fold.
let acc = 0;
for (let i = 0; i < 3; i++) acc += i;
console.log(acc.valueOf());

// The result keeps the receiver's type, so it flows into arithmetic and
// string surface without a cast.
console.log((3.5).valueOf().toFixed(1));
console.log("abc".valueOf().toUpperCase());

// A UNION receiver: Node answers the receiver itself whichever arm it
// holds, so the arms need no common kind.
function show(v: string | number): string {
  return typeof v.valueOf();
}
console.log(show("x"), show(7));

function widen(v: string | number): string | number {
  return v.valueOf();
}
console.log(widen("y"), widen(8));

// The receiver is evaluated exactly once, effects and all.
let calls = 0;
const bump = (): number => {
  calls += 1;
  return calls * 10;
};
console.log(bump().valueOf(), calls);

// Inside a chain, beside the toString sibling this file's lowering
// already carried.
console.log((255).toString(16).valueOf(), (255).valueOf().toString(16));
