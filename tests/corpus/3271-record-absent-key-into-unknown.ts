// An index-signature keyed read whose key is ABSENT, flowing into an
// `unknown` slot. `node.attrs.id` on a `Readonly<Record<string, string>>` is
// the shape: without `noUncheckedIndexedAccess` tsc types the read `string`,
// and the value's destination is a log context typed `Readonly<Record<string,
// unknown>>`. Node answers `undefined` for the missing key and stores it; the
// compiled read used to be typed by the CHECKER and so had nowhere to put an
// absent key — the emitted helper trapped, uncatchably, on a line that in
// Node just logs `id: undefined`.
//
// The read now takes the DESTINATION's width when that destination is a dyn
// slot: the toDyn conversion that used to wrap the read moves inside the
// keyed-read helper, so a HIT is the same value it always was and a MISS is
// the dyn undefined singleton — the miss answer the helper already gave for
// dyn-valued signatures. A slot that CANNOT hold undefined keeps the trap
// (see the `string` local at the bottom, which is deliberately not exercised
// here): the checker claimed a type nothing can honour, and a loud refusal
// beats a silent wrong answer.
//
// Everything below is behaviour Node and scriptc AGREE on.

type Attrs = Readonly<Record<string, string>>;

interface BinaryNode {
  readonly tag: string;
  readonly attrs: Attrs;
}

function logCtx(msg: string, ctx: Readonly<Record<string, unknown>>): void {
  console.log(msg, JSON.stringify(ctx), Object.keys(ctx).join("|"));
}

// 1. The zapo site: a log context built from a node whose `id` is absent.
const withId: BinaryNode = { tag: "iq", attrs: { id: "42", type: "set" } };
const noId: BinaryNode = { tag: "ib", attrs: { type: "set" } };
logCtx("with", { tag: withId.tag, id: withId.attrs.id, type: withId.attrs.type });
logCtx("without", { tag: noId.tag, id: noId.attrs.id, type: noId.attrs.type });

// 2. The bare declaration form, hit and miss, with every reader of a dyn.
const hit: unknown = withId.attrs.id;
const miss: unknown = noId.attrs.id;
console.log("hit", hit, typeof hit, hit === undefined, hit === null);
console.log("miss", miss, typeof miss, miss === undefined, miss === null);
console.log("str", String(hit), String(miss));

// 3. The key is PRESENT: the value is the value, unchanged.
console.log("present-eq", hit === "42");

// 4. A dynamic (non-literal) key over the same shape.
const probes: readonly string[] = ["id", "type", "nope"];
for (const k of probes) {
  const v: unknown = noId.attrs[k];
  console.log("dyn-key", k, v, typeof v);
}

// 5. Non-string index values: the f64 and bool overflow arms, and a
//    composite (array) one, all joining at dyn.
type Nums = Readonly<Record<string, number>>;
type Bools = Readonly<Record<string, boolean>>;
type Lists = Readonly<Record<string, readonly string[]>>;
const nums: Nums = { a: 1 };
const bools: Bools = { a: true };
const lists: Lists = { a: ["x"] };
const nh: unknown = nums.a;
const nm: unknown = nums.zz;
const bh: unknown = bools.a;
const bm: unknown = bools.zz;
const lh: unknown = lists.a;
const lm: unknown = lists.zz;
console.log("nums", nh, nm, typeof nh, typeof nm);
console.log("bools", bh, bm, typeof bh, typeof bm);
console.log("lists", JSON.stringify(lh), lm, typeof lm);

// 6. A shape with DECLARED fields as well as a signature: the declared hit,
//    the overflow hit and the miss all surface at dyn.
interface Mixed {
  readonly tag: string;
  readonly n: number;
  readonly [k: string]: string | number;
}
const mixed: Mixed = { tag: "t", n: 7, extra: "e" };
const md: unknown = mixed.tag;
const mn: unknown = mixed.n;
const mo: unknown = mixed.extra;
const mm: unknown = mixed.nope;
console.log("mixed", md, mn, mo, mm);
console.log("mixed-types", typeof md, typeof mn, typeof mo, typeof mm);

// 7. An absent value STORED under a dyn signature keeps its key, exactly as
//    JS does: Object.keys sees it, JSON.stringify drops it.
const box: Record<string, unknown> = { p: withId.attrs.id, q: noId.attrs.id };
console.log("box-keys", Object.keys(box).join(","), JSON.stringify(box));
console.log("box-q-undef", box.q === undefined);

// 8. Reassignment through a mutable dyn local, both ways round.
let cur: unknown = noId.attrs.id;
console.log("cur-1", cur);
cur = withId.attrs.id;
console.log("cur-2", cur);

// 9. Function ARGUMENTS typed unknown take the same width.
function describe(v: unknown): string {
  return typeof v === "string" ? `s:${v}` : v === undefined ? "u" : "?";
}
console.log("arg", describe(withId.attrs.id), describe(noId.attrs.id));

// 10. Many reads in a loop, so the interned helper is exercised repeatedly.
let seen = 0;
for (let i = 0; i < 50; i++) {
  const v: unknown = (i % 2 === 0 ? withId : noId).attrs.id;
  if (v === undefined) seen++;
}
console.log("loop-misses", seen);
