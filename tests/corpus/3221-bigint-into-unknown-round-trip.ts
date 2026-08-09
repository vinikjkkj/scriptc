// A bigint crossing into `unknown` and back -- SCR_DYN_BIG, the first
// PRIMITIVE among the recently added checked-dynamic kinds, and the
// reason that distinction is not decoration.
//
// The three kinds added before this one (a class instance, an
// ArrayBuffer, a promise) are REFERENCE values: identity is the pointer,
// truthiness is unconditionally true, and almost every operation on them
// is a loud fence. Inheriting that stance here would answer WRONG rather
// than refuse, in two places this program pins:
//
//   * `0n` is FALSY. Every reference kind is always truthy, and the
//     truthiness switch's own default is always FALSE, so a bigint that
//     merely fell through would take the wrong branch in silence.
//   * `===` compares by VALUE. Two separately built 7n are ===-equal in
//     JS; two boxes of a reference kind are equal only when the pointer
//     is. A pointer comparison here is a wrong BOOLEAN, not an
//     approximation.
//
// And two more the reference kinds get to fence and this one must not:
// String() renders the digits (a bigint has a real toString), and
// JSON.stringify THROWS -- which is an ANSWER, V8's own TypeError, not a
// gap in the tier.
//
// NO BIGINT LITERALS anywhere in this file, deliberately. Literals are
// outside the LLVM tier (SC3001, no ScrBigInt literal ABI), so spelling
// one would move the whole program to the C lane and leave the new dyn
// surface untested in the other. Every bigint here is built with
// BigInt(<number>), which both tiers lower.

import { inspect } from "node:util";
import assert from "node:assert";

function big(n: number): bigint {
  return BigInt(n);
}

// The crossing itself: a bigint into an `unknown` slot and back out.
const u: unknown = big(7);
console.log("typeof:", typeof u);
console.log("String:", String(u));
console.log("as bigint:", String(u as bigint));

// typeof is the kind's OWN answer -- no other dyn kind says "bigint",
// which is the whole reason this is a kind rather than a flag on the
// number one. protobufjs's `long` dispatches on exactly this test:
//   Long.fromValue = (v, u) => typeof v === "bigint" ? fromBigInt(v, u) : ...
function classify(v: unknown): string {
  if (typeof v === "bigint") return "bigint";
  if (typeof v === "number") return "number";
  if (typeof v === "object") return "object";
  return "other";
}
console.log("classify:", classify(u), classify(1), classify({}), classify("s"));

// VALUE equality, both ways, and across two independent boxes.
const a: unknown = big(7);
const b: unknown = big(7);
const c: unknown = big(8);
console.log("a===b:", a === b, "a===c:", a === c);
console.log("a===7-as-number:", (a as unknown) === (7 as unknown));
// Round trip preserves the value (a bigint is immutable, so "identity"
// and "value" are the same question -- unlike the instance box).
console.log("round trip:", String((a as bigint)) === String((b as bigint)));

// Truthiness, the arm whose default answer is wrong in BOTH directions.
const zero: unknown = big(0);
const neg: unknown = big(-3);
console.log("0n truthy:", zero ? "yes" : "no");
console.log("7n truthy:", u ? "yes" : "no");
console.log("-3n truthy:", neg ? "yes" : "no");
console.log("!!:", !zero, !u);

// Negative and large values render correctly through the boundary.
const many: unknown[] = [big(0), big(-1), big(255), big(-255), big(9007199254740991)];
console.log("rendered:", many.map((v) => String(v)).join(","));

// util.inspect KEEPS the n suffix where String() drops it.
console.log("inspect:", inspect(u), inspect(zero), inspect(neg));
console.log("inspect list:", inspect(many));

// JSON.stringify throws V8's own TypeError -- the ANSWER, not a fence.
try {
  JSON.stringify(u);
  console.log("json: NO THROW (wrong)");
} catch (e) {
  console.log("json:", (e as Error).name + ": " + (e as Error).message);
}
// And nested, where the walker meets it one container down. The
// container is itself a dyn, because a STATIC record with an `unknown`
// field has its own separate fence (SC1090) that has nothing to do with
// bigint and would hide this case behind an unrelated refusal.
const nested: unknown = [big(1), big(2)];
try {
  JSON.stringify(nested);
  console.log("json nested: NO THROW (wrong)");
} catch (e) {
  console.log("json nested:", (e as Error).message);
}

// structuredClone COPIES a bigint (they are cloneable) -- the
// DataCloneError every other opaque kind gets would be a wrong claim.
const cloned: unknown = structuredClone(u);
console.log("clone:", inspect(cloned), cloned === u);

// deepStrictEqual over two boxes compares the VALUE, like ===.
assert.deepStrictEqual(a, b);
console.log("deepStrictEqual(7n, 7n): ok");
try {
  assert.deepStrictEqual(a, c);
  console.log("deepStrictEqual(7n, 8n): NO THROW (wrong)");
} catch {
  console.log("deepStrictEqual(7n, 8n): threw");
}

// (A FAILED dynCheck -- `(5 as unknown) as bigint` -- is deliberately NOT
// exercised here. `as` is erased in Node and CHECKED here, so the two
// sides cannot agree byte for byte on a cast that is meant to fail; the
// message is pinned by the runtime's own check-failure path instead.)

// A bigint ARM of a union re-entered from a dyn. This is `BigInt`'s own
// declared parameter type (`bigint | boolean | number | string`), which
// is why zapo reaches it at all, and the interesting part is that
// dynMatch tests the KIND: a plain 34 must take the number arm and 12n
// the bigint arm. Had bigint ridden SCR_DYN_NUM with a flag, one of these
// would wear the other's tag and render as garbage rather than fence.
// `typeof` and `String()` on a statically-typed UNION each have their own
// unrelated fences, so the arm is observed by sending the checked value
// straight back out to `unknown` -- which also makes this a round trip
// through BOTH walkers: dynMatch picks the arm on the way in, the arm's
// own converter boxes it on the way out, and a bigint that came back as
// a number would show up in the typeof.
function through(v: unknown): unknown {
  const w = v as bigint | boolean | number | string;
  const back: unknown = w;
  return back;
}
for (const probe of [big(12) as unknown, 34 as unknown, "x" as unknown, true as unknown]) {
  const r = through(probe);
  console.log("union arm:", typeof r, String(r));
}

// A bigint inside a RECORD crossing into unknown and back.
interface Row { id: bigint; name: string }
function makeRow(n: number): Row {
  return { id: big(n), name: "r" + String(n) };
}
const boxed: unknown = makeRow(9);
const back = boxed as Row;
console.log("record:", String(back.id), back.name);

// And inside an ARRAY.
const arrBoxed: unknown = [big(1), big(2)];
const arrBack = arrBoxed as bigint[];
console.log("array:", arrBack.map((v) => String(v)).join("|"));

// A function whose RETURN is a bigint, boxed into an unknown slot and
// called back through the dyn boundary -- zapo's `S.toBigInt = ...` on a
// prototype object, which is the site this whole surface exists for.
function callThrough(f: unknown): string {
  const g = f as () => bigint;
  return String(g());
}
console.log("fn return:", callThrough(() => big(42)));

// A function TAKING a bigint, the other direction of the same box.
function applyTo(f: unknown, v: bigint): string {
  const g = f as (x: bigint) => bigint;
  return String(g(v));
}
console.log("fn param:", applyTo((x: bigint) => x + x, big(21)));
