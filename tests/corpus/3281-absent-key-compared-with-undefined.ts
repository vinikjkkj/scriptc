// An index-signature keyed read COMPARED with `undefined` — the test whose
// whole point is the absent key, on the reads whose declared type cannot
// spell one. `node.attrs.offline !== undefined` on a
// `Readonly<Record<string, string>>` types as `string !== undefined`, which
// the checker calls always-true; the lowering used to FOLD it to a constant
// and delete the read with it. No value, no trap, no diagnostic — zapo
// counted every incoming stanza as an offline stanza, and the key
// expression's own side effects vanished too.
//
// A comparison against a unit literal is itself a destination that can say
// undefined, so the read is taken at DYN width (the same routing a dyn SLOT
// gets) and the kind test a `Record<string, unknown>` read has always used
// answers it: a hit tests the value's kind, a miss tests the undefined
// singleton. Truthiness takes the same route — `if (attrs.id)` is the
// author's own absent-key branch, and it used to TRAP on the way to a
// ToBoolean that would have answered false.
//
// Only the reads whose miss is representable move: a signature-free shape's
// keyed read was proven to name a declared field, a read that can already
// say undefined already had a real tag test, and a value type outside the
// toDyn walker's domain keeps the trap.
//
// Everything below is behaviour Node and scriptc AGREE on.

type Attrs = Readonly<Record<string, string>>;

interface BinaryNode {
  readonly tag: string;
  readonly attrs: Attrs;
}

// 1. The zapo site, verbatim in shape: an offline-stanza counter driven by
//    the presence of an attribute that most stanzas do not carry.
let offlineSeen = 0;
function track(node: BinaryNode): void {
  if (node.attrs.offline !== undefined) {
    offlineSeen++;
  }
}
track({ tag: "message", attrs: { offline: "1", id: "a" } });
track({ tag: "message", attrs: { id: "b" } });
track({ tag: "iq", attrs: { type: "get" } });
console.log("offlineSeen", offlineSeen);

// 2. Every spelling, over a hit and a miss.
const hit: Attrs = { k: "v" };
const miss: Attrs = { other: "v" };
function spellings(m: Attrs, label: string): void {
  console.log(label, "neq-undef", m.k !== undefined);
  console.log(label, "eq-undef", m.k === undefined);
  console.log(label, "ne-null", m.k != null);
  console.log(label, "eq-null-loose", m.k == null);
  console.log(label, "truthy", m.k ? "T" : "F");
  console.log(label, "bang", !m.k);
  console.log(label, "bangbang", !!m.k);
  console.log(label, "ternary", m.k === undefined ? "absent" : "present");
  console.log(label, "and", m.k !== undefined && label.length > 0);
  console.log(label, "or", m.k === undefined || label.length > 0);
  console.log(label, "objectIs", Object.is(m.k, undefined));
}
spellings(hit, "hit");
spellings(miss, "miss");

// 3. A FALSY hit is present: the two questions differ, and both must answer.
const falsy: Attrs = { k: "" };
console.log("falsy neq-undef", falsy.k !== undefined);
console.log("falsy truthy", falsy.k ? "T" : "F");
console.log("falsy ne-null", falsy.k != null);

// 4. The bracket form and a runtime (non-literal) key.
const nameHit = "k";
const nameMiss = "zz";
console.log("bracket hit", hit["k"] !== undefined, "miss", miss["k"] !== undefined);
console.log("runtime hit", hit[nameHit] !== undefined, "miss", hit[nameMiss] !== undefined);

// 5. The key expression's side effects survive the test (the fold deleted
//    them: the call never ran and the counter never moved).
let keyCalls = 0;
function keyOf(n: string): string {
  keyCalls++;
  console.log("keyOf", n);
  return n;
}
console.log("effect miss", miss[keyOf("k")] !== undefined);
console.log("effect hit", hit[keyOf("k")] !== undefined);
console.log("keyCalls", keyCalls);

// 6. Narrowing through the guard: the branch that runs reads the value.
function describe(m: Attrs): string {
  if (m.k !== undefined) {
    return "has:" + m.k + ":" + String(m.k.length);
  }
  return "none";
}
console.log(describe(hit), describe(miss), describe(falsy));

// 7. Declared fields ALONGSIDE a signature: the declared one is not a keyed
//    read at all and keeps its static answer; the overflow key tests.
interface Hybrid {
  readonly tag: string;
  readonly [k: string]: string;
}
const hy: Hybrid = { tag: "t", extra: "e" };
console.log("hybrid tag", hy.tag !== undefined, "extra", hy.extra !== undefined, "gone", hy.gone !== undefined);

// 8. Scalar-valued signatures (the f64/bool overflow arms), including the
//    falsy-but-present values.
type Nums = Readonly<Record<string, number>>;
type Bools = Readonly<Record<string, boolean>>;
const nums: Nums = { zero: 0, one: 1 };
const bools: Bools = { no: false };
console.log("num zero", nums.zero !== undefined, nums.zero ? "T" : "F");
console.log("num absent", nums.two !== undefined, nums.two == null);
console.log("bool false", bools.no !== undefined, bools.no ? "T" : "F");
console.log("bool absent", bools.yes !== undefined, bools.yes == null);

// 9. A composite value type (the reference overflow arm).
type Lists = Readonly<Record<string, readonly string[]>>;
const lists: Lists = { a: ["x", "y"] };
console.log("list hit", lists.a !== undefined, "miss", lists.b !== undefined);
console.log("list truthy", lists.a ? "T" : "F", lists.b ? "T" : "F");

// 10. Reads that ALREADY answer undefined are untouched: an `unknown`-valued
//     signature (the read is a dyn already) and an explicitly optional value
//     type (the read is an undefined-armed union).
type Unk = Readonly<Record<string, unknown>>;
type Opt = Readonly<Record<string, string | undefined>>;
const unk: Unk = { k: "v" };
const opt: Opt = { k: "v", blank: undefined };
console.log("unk hit", unk.k !== undefined, "miss", unk.zz !== undefined);
console.log("opt hit", opt.k !== undefined, "blank", opt.blank !== undefined, "miss", opt.zz !== undefined);

// 11. The interned helper under repetition: fifty reads, half of them misses.
let present = 0;
for (let i = 0; i < 50; i++) {
  const key = i % 2 === 0 ? "k" : "gone" + String(i);
  if (hit[key] !== undefined) {
    present++;
  }
}
console.log("present", present);

// 12. The guard-then-read idiom, where the truthiness test and the value
//     read are the SAME key: the short circuit is what keeps the read on the
//     present side.
function width(m: Attrs): number {
  return m.k && m.k.length > 0 ? m.k.length : -1;
}
console.log("width", width(hit), width(miss), width(falsy));
let spins = 0;
const drain: Record<string, string> = { k: "aaa" };
while (drain.k) {
  spins++;
  const rest = drain.k.slice(1);
  if (rest === "") {
    delete drain.k;
  } else {
    drain.k = rest;
  }
}
console.log("spins", spins, "left", drain.k !== undefined);

// 13. A mutable record: a key that appears between two tests.
const grow: Record<string, string> = {};
console.log("grow before", grow.k !== undefined, grow.k ? "T" : "F");
grow.k = "now";
console.log("grow after", grow.k !== undefined, grow.k ? "T" : "F");
delete grow.k;
console.log("grow deleted", grow.k !== undefined, grow.k == null);
