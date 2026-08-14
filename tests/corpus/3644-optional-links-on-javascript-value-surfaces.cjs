// Two guards that are reachable in a JAVASCRIPT source and NOT in a
// TypeScript one — probed both ways rather than assumed, because the
// difference decides whether converting them is a fix or a no-op.
//
//   `s?.trim` (stringMethodFnValuePlan) — the string-intrinsic function
//   VALUE lift, which is JS-only by construction: its body reads the
//   ambient receiver, and a TypeScript consumer has no way to bind one
//   (`this` in a plain function is SC1080 there). The receiver is a plain
//   string, never nullish, so the chain proves it and re-dispatches — and
//   the raw token test declined that re-dispatch, dropping the site on
//   "string methods as values (call 'trim' directly)".
//
//   `Object?.freeze` in a ToBoolean-only position (stdlibExistenceTestOf)
//   — the capability test a bundled library opens with (2931 pins the
//   plain spelling, protobufjs's util.js verbatim). The receiver is a
//   stdlib global, so the link cannot short-circuit and the answer is the
//   same constant `true`. In a TypeScript source the chain fences on the
//   receiver first (`SC2020: 'Object'`) and the guard is never consulted;
//   here it is.
//
// The value question and the existence question stay separate, which is
// the rule's own theorem: `Object?.freeze` as a TEST answers true, while
// `Object.freeze` as a VALUE is still a fence. Only the first is claimed.

// ── the string function-value lift, through the optional link ──────────
const s = "  padded  ";
const trim = s?.trim;
console.log("type:", typeof trim);
console.log("through call:", trim.call(s));
console.log("agrees with plain:", trim.call(s) === s.trim());

const upper = s?.toUpperCase;
console.log("upper:", upper.call("hi"));

const at = "abcdef"?.charAt;
console.log("charAt:", at.call("abcdef", 3));

// The same member read the ordinary way, beside it.
console.log("plain lift:", typeof s.trim, s.trim.call(s));

// ── the capability test, every ToBoolean-only spelling ─────────────────
function pin(t) {
  t.emptyArray = Object?.freeze ? Object.freeze([]) : [];
  t.emptyObject = Object?.freeze ? Object.freeze({}) : {};
  return t;
}
const util = pin({});
console.log(JSON.stringify(util.emptyArray), util.emptyArray.length);
console.log(JSON.stringify(util.emptyObject), Object.keys(util.emptyObject).length);

if (Object?.freeze) { console.log("if:", JSON.stringify(Object.freeze([1, 2]))); }
let n = 0;
while (Object?.freeze) { n += 1; if (n > 1) break; }
for (let i = 0; Object?.freeze; i += 1) { n += 1; if (i === 2) break; }
console.log("loops:", n, !Object?.freeze, !!Object?.freeze);

// Other globals, the same shape.
console.log(!Object?.seal, !Object?.assign, !Array?.from, !Object?.entries);
console.log(!Math?.pow, !JSON?.stringify, !Array?.isArray, !String?.fromCharCode);

// A DATA member is deliberately NOT in the rule: its truthiness is the
// value's, not the declaration's, and it keeps the answer it already had.
console.log(Math.PI ? "pi" : "-", Number.MAX_SAFE_INTEGER ? "max" : "-");

// The ternary form, whose branch calls the member so tsc's own TS2774
// ("this function is always defined") stays suppressed — the same reason
// 2931 spells it that way.
const answer = Object?.freeze ? "present:" + JSON.stringify(Object.freeze([3])) : "absent";
console.log("ternary:", answer);

// The NEGATED form, which needs no call to suppress anything.
console.log("negated:", !Object?.freeze, "double:", !!Object?.freeze);
