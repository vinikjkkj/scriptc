// A `Set<T>` arm inside a union whose siblings are DATA, not units — the
// shape mongodb's `defineAspects` declares:
//
//     function defineAspects(op, aspects: symbol | symbol[] | Set<symbol>)
//
// All three arms are "collections of symbols" at a glance, and the union is
// only honest if the run time can tell them apart. It can, because a
// compiled union is TAGGED: `typeof x === "symbol"` splits the scalar arm,
// `Array.isArray(x)` is the array arm's tag test, and `x instanceof Set` is
// the set arm's — three tag compares over the same word, exact against
// every sibling kind rather than only the ones `typeof` happens to split.
//
// The properties pinned here are the ones a wrong re-tag would break: a Set
// and an array with the SAME contents must answer differently, the two
// EMPTY containers must answer differently (nothing about the payload
// distinguishes them — only the tag does), and each arm must survive being
// written into the union and read back out.

const A = Symbol("a");
const B = Symbol("b");

type Aspects = symbol | symbol[] | Set<symbol>;

function kind(x: Aspects): string {
  if (Array.isArray(x)) return "array";
  if (x instanceof Set) return "set";
  return "symbol";
}

function size(x: Aspects): number {
  if (Array.isArray(x)) return x.length;
  if (x instanceof Set) return x.size;
  return 1;
}

// Each arm, constructed and read back through a union-typed binding.
let v: Aspects = A;
console.log(kind(v), size(v));
v = [A, B];
console.log(kind(v), size(v));
v = new Set<symbol>([A, B]);
console.log(kind(v), size(v));

// The same contents in the two container arms: told apart by the tag, not
// by anything readable off the payload.
const asArray: Aspects = [A, B];
const asSet: Aspects = new Set<symbol>([A, B]);
console.log(kind(asArray), kind(asSet));
console.log(size(asArray) === size(asSet));

// The EMPTY pair — the case with no content at all to distinguish.
const emptyArray: Aspects = [];
const emptySet: Aspects = new Set<symbol>();
console.log(kind(emptyArray), size(emptyArray));
console.log(kind(emptySet), size(emptySet));

// `typeof` over the union: "symbol" picks exactly one arm, "object" picks
// the other two (the tag-in-set chain).
function tof(x: Aspects): string {
  if (typeof x === "symbol") return "T:symbol";
  if (typeof x === "object") return "T:object";
  return "T:?";
}
console.log(tof(A), tof(asArray), tof(asSet));

// Iteration after narrowing: for-of over each container arm, and spread
// out of the set arm.
function join(x: Aspects): string {
  const out: string[] = [];
  if (Array.isArray(x)) {
    for (const s of x) out.push(s.toString());
    return "A(" + out.join(",") + ")";
  }
  if (x instanceof Set) {
    for (const s of x) out.push(s.toString());
    const spread = [...x];
    return "S(" + out.join(",") + ")#" + spread.length;
  }
  return "Y(" + x.toString() + ")";
}
console.log(join([A, B]));
console.log(join(new Set<symbol>([A, B])));
console.log(join(A));

// The union as a RETURN type as well as a parameter type, with all three
// arms flowing out of one function.
function pick(n: number): Aspects {
  if (n === 0) return A;
  if (n === 1) return [A, B, A];
  return new Set<symbol>([A, B, A]);
}
for (let i = 0; i < 3; i++) {
  const got = pick(i);
  console.log(i, kind(got), size(got));
}

// The narrowing sequence `defineAspects` actually writes, with the Set
// built by hand (a union argument to `new Set(...)` keeps its own fence).
function normalize(aspects: Aspects): Set<symbol> {
  const out = new Set<symbol>();
  if (Array.isArray(aspects)) {
    for (const a of aspects) out.add(a);
  } else if (aspects instanceof Set) {
    for (const a of aspects) out.add(a);
  } else {
    out.add(aspects);
  }
  return out;
}
console.log(normalize(A).size, normalize([A, B, A]).size, normalize(new Set<symbol>([A])).size);

// The `!isArray && !(instanceof Set)` spelling, negated and conjoined —
// the exact condition in mongodb's source.
function isBare(aspects: Aspects): boolean {
  return !Array.isArray(aspects) && !(aspects instanceof Set);
}
console.log(isBare(A), isBare([A]), isBare(new Set<symbol>([A])));

// A set arm mutated through the narrowing, and the mutation visible on the
// original binding (the arm holds the SET, never a copy).
const live = new Set<symbol>([A]);
const held: Aspects = live;
if (held instanceof Set) held.add(B);
console.log(live.size, [...live].length);
