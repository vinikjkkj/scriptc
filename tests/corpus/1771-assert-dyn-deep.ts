// assert.deepStrictEqual / notDeepStrictEqual over CHECKED-DYNAMIC
// operands — the structural dyn walk: Object.is numbers, byte-equal
// strings, per-element arrays, key-set objects, brand-aware bytes (the
// Buffer flavor bit is the prototype Node compares first), closure
// identity for functions. A static side crosses into the checked-dynamic tree when it is
// JSON-safe (records/arrays/scalars/units); the generated messages are
// assertion_error.js's — compact:false sorted rendering, the real myers
// line diff with 5 context lines, "..." collapsing and the
// "... Skipped lines" banner, comma disparity between object lines.
import assert from "node:assert";

function msgOf(fn: () => void): string {
  try {
    fn();
    return "PASS";
  } catch (e) {
    return e instanceof Error ? `${e.name}|${JSON.stringify(e.message)}` : "not an Error";
  }
}

const dobj: unknown = JSON.parse('{"a":1,"b":[true,null,"x"]}');
const dobj2: unknown = JSON.parse('{"b":[true,null,"x"],"a":1}'); // key order differs
const darr: unknown = JSON.parse("[1,2]");

// The passing surface.
assert.deepStrictEqual(dobj, dobj2); // key order is not identity
assert.deepStrictEqual(darr, [1, 2]); // dyn vs static array
assert.deepStrictEqual(dobj, { a: 1, b: [true, null, "x"] as (boolean | null | string)[] });
assert.deepStrictEqual(JSON.parse("[]"), []);
assert.deepStrictEqual(JSON.parse("{}"), {});
assert.deepStrictEqual(JSON.parse("1"), 1);
assert.deepStrictEqual(JSON.parse("null"), null);
assert.notDeepStrictEqual(darr, [2, 1]);
assert.notDeepStrictEqual(dobj, JSON.parse('{"a":1,"b":[true,null,"y"]}'));
assert.notDeepStrictEqual(JSON.parse("0"), -0); // strict deep: Object.is numbers
console.log("deep passes ok");

// Failures: the myers diff with context lines and comma disparity.
console.log(msgOf(() => assert.deepStrictEqual(dobj, JSON.parse('{"a":2,"b":[true,null,"x"]}'))));
console.log(msgOf(() => assert.deepStrictEqual(darr, [1, 3])));
console.log(msgOf(() => assert.deepStrictEqual(JSON.parse('{"a":1,"b":2}'), JSON.parse('{"a":1}'))));
console.log(msgOf(() => assert.deepStrictEqual(darr, [])));
console.log(msgOf(() => assert.deepStrictEqual(JSON.parse("[]"), [1])));
console.log(msgOf(() => assert.deepStrictEqual(JSON.parse("5"), 7)));
console.log(msgOf(() => assert.deepStrictEqual(JSON.parse('"x"'), "y")));
console.log(msgOf(() => assert.deepStrictEqual(JSON.parse("5"), JSON.parse('{"a":1}'))));

// Long common runs: 5 context lines, then the collapse.
const longA: unknown = JSON.parse("[9,1,2,3,4,5,6,7,8,10]");
const longB: unknown = JSON.parse("[0,1,2,3,4,5,6,7,8,11]");
console.log(msgOf(() => assert.deepStrictEqual(longA, longB)));
const tailA: unknown = JSON.parse("[9,1,2,3,4,5,6,7,8]");
const tailB: unknown = JSON.parse("[0,1,2,3,4,5,6,7,8]");
console.log(msgOf(() => assert.deepStrictEqual(tailA, tailB)));

// Sorted rendering: entries sort by their RENDERED text (quoted keys
// order before bare ones — Node's sorted:true sorts formatted entries).
const sortA: unknown = JSON.parse('{"b":1,"a":[1,{"d":2,"c":3}],"a-b":true}');
const sortB: unknown = JSON.parse('{"b":1,"a":[1,{"d":2,"c":4}],"a-b":true}');
console.log(msgOf(() => assert.deepStrictEqual(sortA, sortB)));

// notDeepStrictEqual failing: the block rendering of the actual value.
console.log(msgOf(() => assert.notDeepStrictEqual(dobj, dobj2)));
console.log(msgOf(() => assert.notDeepStrictEqual(JSON.parse("5"), 5)));
console.log(msgOf(() => assert.notDeepStrictEqual(darr, [1, 2], "custom ndse")));

// Key sets that differ across the record/dyn crossing: the record answers the
// keys it HOLDS, so a declared field the value does not hold is not a key on
// either side, and the difference the assertion reports is the parsed value's
// extra member — exactly Node.
//
// NOT asserted, deliberately, and it used to be: the same shape built with
// `b: undefined` written explicitly, against a parsed '{"a":1}'. Node makes
// that a key-set difference ("- b: undefined"); scriptc answers "absent" for
// an explicitly-written undefined, because `{b?: number}` and
// `{b: number | undefined}` intern to the SAME record shape and a record
// carries one union tag per field — no per-instance bit separates "written
// undefined" from "never written". The stance is the one tests/corpus/3713
// names. The pair below is the OTHER construction, and it was wrong before
// the presence gate: the expected side reported a phantom `b: undefined` key
// it does not hold.
interface MaybeB {
  a: number;
  b?: number;
}
const plain: unknown = JSON.parse('{"a":1,"b":2}');
console.log(msgOf(() => assert.deepStrictEqual(plain, { a: 1 } as MaybeB)));
// The UNDEF value itself still renders and compares inside the checked-dynamic
// tree — an array slot is the crossing that carries one after the gate.
console.log(msgOf(() => assert.deepStrictEqual(JSON.parse("[1,null]"), [1, undefined])));

// Bytes inside the checked-dynamic tree: brand-aware content comparison (both sides
// crossed as unknown, so both carry the plain Uint8Array flavor).
const ua: unknown = new Uint8Array([1, 2]);
const ub: unknown = new Uint8Array([1, 2]);
const uc: unknown = new Uint8Array([1, 3]);
assert.deepStrictEqual(ua, ub);
assert.notDeepStrictEqual(ua, uc);
console.log(msgOf(() => assert.deepStrictEqual(ua, uc)));
console.log(msgOf(() => assert.strictEqual(ua, ub)));

// Functions under the deep pair: closure identity — one closure boxed
// twice is deep-equal, two distinct closures never are.
function cbA(): number {
  return 1;
}
function cbB(): number {
  return 1;
}
const fn1: unknown = cbA;
const fn1again: unknown = cbA;
const fn2: unknown = cbB;
assert.deepStrictEqual(fn1, fn1again);
assert.notDeepStrictEqual(fn1, fn2);
console.log("done");
