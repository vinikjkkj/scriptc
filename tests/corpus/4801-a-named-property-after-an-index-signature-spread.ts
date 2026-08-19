// `{ ...decoded.attrs, id: outbound.messageId }` — zapo's
// `src/retry/replay.ts:369`, one of the three "object spread involving
// index-signature shapes" refusals the real 128 MB TU still carried, and the
// shape a hybrid record can NEVER spell.
//
// tsc DISCARDS a spread source's index signature when it infers a literal's
// type: `{ ...attrs, id }` over `Record<string, string>` types as
// `{ id: string }`. `spreadErasedIndexValue` already recovered that signature
// — but only for literals whose named properties all sit BEFORE every spread,
// because a HYBRID record enumerates its declared fields first and its
// overflow second, and JS enumerates by INSERTION. `{ ...attrs, id }` is
// exactly the arrangement where those two disagree: JS says `zeta,id,alpha`,
// a declared-then-overflow struct can only say `id,zeta,alpha`.
//
// The fix is not a wider hybrid. It is to stop building a hybrid at all: when
// a named property sits after a spread, EVERY member folds into the
// insertion-ordered store and the shape is the PURE index-signature record.
// The store already overwrites in place, so `id` lands where JS puts it —
// at its position in the source when the source carried it, last when it did
// not — and `Object.keys`, `JSON.stringify`, `for...in`, `Object.values` and
// `Object.entries` all agree with Node without a single new runtime.
//
// Every case below is a DIFFERENT arrangement of named properties and
// spreads, because the arrangement is the whole question:
//   b1  spread, then a named key the source ALREADY carries  (overwrite in place)
//   b2  spread, then a named key the source does NOT carry   (appended last)
//   b3  named BEFORE and AFTER a spread                      (both positions kept)
//   b4  a named key BETWEEN two spreads
//   b5  the historic named-first arrangement — a HYBRID, and unchanged by this
//   b6  an EMPTY source: the named property is the whole object
//   c1  a runtime-COMPUTED key after a spread
//   c2  a SHORTHAND after a spread
//   c4  an ARRAY-INDEX-like key in the source: JS lists it first, and so does
//       the store — the one ordering rule that is not insertion order
//   n1  a number-valued slot; m1  a UNION-valued slot with a narrower member

function show(tag: string, o: Record<string, string>): void {
  console.log(tag + " [" + Object.keys(o).join("|") + "] " + JSON.stringify(o));
}

const src: Readonly<Record<string, string>> = { zeta: "z", id: "old", alpha: "a" };
const other: Readonly<Record<string, string>> = { omega: "w" };
const empty: Readonly<Record<string, string>> = {};

const b1 = { ...src, id: "new" };
const b2 = { ...src, fresh: "f" };
const b3 = { first: "1", ...src, last: "9" };
const b4 = { ...src, mid: "m", ...other };
const b5 = { id: "pre", ...src };
const b6 = { ...empty, only: "o" };

show("b1", b1);
show("b2", b2);
show("b3", b3);
show("b4", b4);
show("b5", b5);
show("b6", b6);

const K = "dyn" + "amic";
const c1 = { ...src, [K]: "D" };
show("c1", c1);

const alpha = "SHORT";
const c2 = { ...src, alpha };
show("c2", c2);

// The folded value as a FIELD of an outer literal, and read back through it.
const c3 = { tag: "t", attrs: { ...src, id: "new" } };
show("c3.attrs", c3.attrs);
console.log("c3.tag " + c3.tag);

const indexed: Readonly<Record<string, string>> = { b: "B", "0": "Z", a: "A" };
const c4 = { ...indexed, tail: "T" };
show("c4", c4);

// Reads: dot access on a folded member is the bracket access in dot spelling.
console.log("reads " + b1.id + " " + b3.last + " " + b6.only + " " + c1[K] + " " + c2.alpha);
console.log("in " + String("id" in b1) + " " + String("nope" in b1) + " " + String("last" in b3));

let walk = "";
for (const k in b4) walk += k + ";";
console.log("forin b4 " + walk);
console.log("values b3 " + Object.values(b3).join(",") + " entries0 " + Object.entries(b3)[0]![0]);

const nums: Readonly<Record<string, number>> = { b: 2, a: 1 };
const n1 = { ...nums, c: 3 };
console.log("n1 [" + Object.keys(n1).join("|") + "] " + JSON.stringify(n1) + " c=" + String(n1.c));

type Slot = string | boolean | null;
const mixed: Readonly<Record<string, Slot>> = { one: "1", two: true, three: null };
const m1 = { ...mixed, four: false };
console.log("m1 [" + Object.keys(m1).join("|") + "] " + JSON.stringify(m1) + " four=" + String(m1.four));
