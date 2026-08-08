// The capability test a bundled library opens with, verbatim. protobufjs's
// util.js pins its two empty singletons behind a READ of Object.freeze:
//
//     util.emptyArray = Object.freeze ? Object.freeze([]) : [];
//
// The read asks whether the member EXISTS; it is not the function value.
// Its only consumer is ToBoolean, and a standard-library global's declared,
// non-optional, callable member is always defined — tsc asserts exactly
// that itself (TS2774, "this function is always defined", which it
// suppresses here only because the branch calls it) — so the answer is the
// constant true and no function value is ever materialized. The
// `Object.freeze(...)` CALLS beside the tests are the ordinary fresh-literal
// lowering, untouched: freeze of a fresh literal is identity because its
// frozen-ness is unobservable, and freeze of an ALIASED value still refuses.
// That refusal is why this is a truthiness rule and not a function-value
// lift — a lifted closure has no call site to prove freshness at.
function pin(t) {
  t.emptyArray = Object.freeze ? Object.freeze([]) : [];
  t.emptyObject = Object.freeze ? Object.freeze({}) : {};
  return t;
}
const util = pin({});
console.log(JSON.stringify(util.emptyArray), util.emptyArray.length);
console.log(JSON.stringify(util.emptyObject), Object.keys(util.emptyObject).length);

// Every other spelling whose only consumer is ToBoolean.
if (Object.freeze) { console.log(JSON.stringify(Object.freeze([1, 2]))); }
let n = 0;
while (Object.freeze) { n += 1; if (n > 1) break; }
for (let i = 0; Object.freeze; i += 1) { n += 1; if (i === 2) break; }
console.log(n, !Object.freeze, !!Object.freeze);

// Other globals, same shape. Some of these members have a deliberate FENCE
// in value position (Math methods as values; the generic-method-as-value
// rule that `freeze`, `from` and `entries` reach) — the existence question
// is a different question, and it has a constant answer either way.
console.log(!Object.seal, !Object.assign, !Array.from, !Object.entries, !Object.values);
console.log(!Math.pow, !JSON.stringify, !Array.isArray, !String.fromCharCode, !Number.isInteger);

// DATA members are deliberately NOT in the rule: their truthiness is the
// value's, not the declaration's, so they keep the answer they already had.
console.log(Math.PI ? "pi" : "-", Number.MAX_SAFE_INTEGER ? "max" : "-");
