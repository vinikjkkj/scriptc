// A bigint arm inside a union, TESTED rather than only stored -- the two
// answers `2716-bigint-into-union.ts` never asks for.
//
// 2716 puts bigints in unions and exercises construction, storage and
// drop. It never writes `if (u)` and never writes `u === v`, and that gap
// is exactly why two silent wrong answers survived in the shipping lane:
//
//   * `unionTruthyHelper`'s `default: return true` swallowed the bigint
//     arm, so `0n` in a `bigint | undefined` union reported TRUTHY on the
//     C backend. A bigint is a PRIMITIVE -- `0n` is falsy -- and the open
//     default was written for JS OBJECTS, which are always truthy.
//   * `unionEqHelper`'s default compared ref arms by POINTER, which is
//     right for objects and wrong for primitives: two heap ScrBigInts
//     holding 5n live at different addresses, so `5n === 5n` reported
//     FALSE. That one was live on BOTH backends.
//
// Both defaults are closed now (UNION_ARM_JS_OBJECT_KINDS), and this
// program is the corpus's proof that the answers match Node. Every line
// below diverged before the fix.

function pick(n: number): bigint | undefined {
  if (n === 0) return 0n;
  if (n === 1) return 7n;
  if (n === 2) return -3n;
  return undefined;
}

// TRUTHINESS. `0n` is the whole point: it is the one bigint that is falsy,
// and the one the object default got wrong.
console.log(pick(0) ? "T" : "F", pick(1) ? "T" : "F", pick(2) ? "T" : "F", pick(3) ? "T" : "F");

// The same test through `!`, `!!` and the falsy-default operator -- three
// lowerings of one ToBoolean, so a fix that only reaches `if` shows here.
const zero = pick(0);
console.log(!zero, !!zero);
console.log((zero || "dflt") === "dflt");
console.log((pick(1) || "dflt") === "dflt");

// A bigint arm beside a DATA sibling rather than a unit: the arm's
// truthiness still has to be read from the value, not from its tag.
function mixed(n: number): bigint | string {
  return n === 0 ? 0n : n === 1 ? 9007199254740993n : "";
}
console.log(mixed(0) ? "T" : "F", mixed(1) ? "T" : "F", mixed(2) ? "T" : "F");

// EQUALITY. Two separately built 5n boxes: equal by VALUE, distinct by
// address. The pointer default answered false for every one of these.
function five(): bigint | undefined {
  return 5n;
}
const a = five();
const b = five();
console.log(a === b, a !== b);
console.log(pick(0) === pick(0), pick(1) === pick(0));
console.log(a === pick(3), pick(3) === pick(3));

// Against a literal, which takes the general unionEq path (the scalar
// literal bridge covers string/number/boolean only, never bigLit).
console.log(a === 5n, a === 6n);

// Big enough to need more than one limb, so the compare is a real
// magnitude walk and not a lucky single-word hit.
function big(k: number): bigint | undefined {
  let t = 1n;
  for (let i = 0; i < k; i++) t *= 1000000007n;
  return t;
}
console.log(big(4) === big(4), big(4) === big(5));

// Sign is part of the value: -3n and 3n differ, and both are truthy.
console.log(pick(2) === -3n, pick(2) === 3n, pick(2) ? "T" : "F");

// Object.is over the same arms -- the SameValue variant of the helper,
// interned separately from strict equality and carrying the same default.
// A bigint has no NaN and no signed zero, so the two must agree.
console.log(Object.is(a, b), Object.is(a, pick(0)), Object.is(pick(0), pick(0)));
