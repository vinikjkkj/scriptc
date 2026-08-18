// `in` and for-in over a union whose arms are HYBRID shapes — declared
// fields beside a string index signature.
//
// Both rules had one answer kind per arm and no more. The `in` classifier
// broke out of its arm loop the moment it saw an index signature, and
// for-in's `walkable` predicate returned null for the same shape — so a
// union of two ordinary option bags fenced with SC1090 / SC1052 even
// though the SINGLE-record path answers both questions for exactly those
// shapes, one call away: the interned `%rec.haskey` presence helper for
// `in`, and objectIterOverIndexShape's key walk for for-in. Applied to
// the tag-checked narrow, the arm's answer is the arm's own and claims
// nothing about a value carrying a different tag.
//
// A PURE index arm still fences and should: its keys can disappear
// mid-walk (`delete obj[k]` is lowered for it), so its walk needs a
// per-visit live-presence guard, and that guard is a property of the ARM
// while the loop has only one.
interface A {
  a: number;
  [k: string]: unknown;
}
interface B {
  b: string;
  [k: string]: unknown;
}

function pick(n: number): A | B {
  return n > 0 ? ({ a: 1 } as A) : ({ b: "x" } as B);
}

const u = pick(1);
const v = pick(-1);

// Declared names answer per arm; a name no arm declares is false on both.
console.log(String("a" in u), String("b" in u), String("zz" in u));
console.log(String("a" in v), String("b" in v), String("zz" in v));

const ku: string[] = [];
for (const k in u) ku.push(k);
console.log(ku.join(","));

const kv: string[] = [];
for (const k in v) kv.push(k);
console.log(kv.join(","));

// And the half that makes the index signature matter: a value whose
// OVERFLOW really holds keys, reached through the same union slot. The
// presence helper walks the declared names first and then the live
// overflow keys, and the for-in walk emits both.
const raw: unknown = JSON.parse('{"a":7,"extra":"e","more":2}');
function pick2(n: number): A | B {
  return n > 0 ? (raw as A) : ({ b: "y" } as B);
}
const w = pick2(1);
console.log(String("a" in w), String("extra" in w), String("more" in w), String("nope" in w));

const kw: string[] = [];
for (const k in w) kw.push(k);
console.log(kw.join(","));
