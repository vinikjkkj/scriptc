// `new Array<unknown>(n)` — the constructor at a slot whose element type
// maps to the checked-dynamic tree rather than to a static array.
//
// `unknown[]` has no dyn-element STATIC array behind it: mapType collapses
// it to one dyn value ("the checked-dynamic tree has real arrays, so
// length/index/push/iteration ride the keyed-dyn paths"). The array
// LITERAL has built that value at this slot for as long as the rule has
// existed; the CONSTRUCTOR met SC2011 instead. This is the second arm of
// the same fallback the JavaScript sources get in 2771.
//
// DECLARED: an UNANNOTATED `new Array(3)` in a TypeScript source still
// fences. The checker types it `any[]` — not `unknown[]` — and `any` in a
// TypeScript source is the fenced family whose remedy is `--dynamic` or a
// restated type. `new Array<unknown>(n)` is that restated type, and it is
// what this file writes. (dynFallbackType draws the same JS/TS line for
// declarations: a JavaScript binding of any inference residue becomes
// dyn, a TypeScript one only for bare checker-`any`.)

const slots = new Array<unknown>(3);
console.log(slots.length, JSON.stringify(slots), typeof slots[0]);
slots[0] = "a";
slots[2] = 3;
console.log(JSON.stringify(slots), slots.length);
slots.push(true);
console.log(JSON.stringify(slots), slots.length);

// The length is a runtime value, not a literal.
function widen(n: number): unknown[] {
  const out = new Array<unknown>(n);
  for (let i = 0; i < n; i++) out[i] = i * i;
  return out;
}
console.log(JSON.stringify(widen(0)), JSON.stringify(widen(4)));

// A length that is not a length is a RangeError here too.
try {
  widen(-1);
} catch (err) {
  console.log((err as Error).name + ": " + (err as Error).message);
}

// The empty and elements forms at the same slot.
const none = new Array<unknown>();
console.log(none.length, JSON.stringify(none));
const some = new Array<unknown>("x", 2, null);
console.log(JSON.stringify(some), some.length);
// One NON-numeric argument is the array's single element, not a length.
const one = new Array<unknown>("2");
console.log(JSON.stringify(one), one.length);
