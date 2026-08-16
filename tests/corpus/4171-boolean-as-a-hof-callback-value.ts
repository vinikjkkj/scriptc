// `Boolean` handed to an array HOF as the callback VALUE.
//
// `BooleanConstructor`'s call signature keeps a type parameter
// (`<T>(value?: T): boolean`), so the value has no compiled instance of its
// own and types.ts pins the one concrete signature it can — the
// string-coercion form `(value: string) => boolean`, which is what the
// option-table idiom (`type: Boolean`, `opt.type === Boolean`) needs. Over
// any element type OTHER than string that pin is a parameter mismatch, and
// the callback slot refused the CONSTRUCTOR's type:
//   SC2005 values of type 'BooleanConstructor' cannot be compiled: the
//   signature keeps its type parameters
// zapo's `Object.values(persistDiff).some(Boolean)` (auth/WaAuthClient.ts:358)
// is exactly that site. `.filter` alone had its own answer already; `some`,
// `every`, `map`, `find` and `findIndex` did not.
//
// The predicate the desugared loop needs is ToBoolean of the ELEMENT, which
// is monomorphic per element type — one interned `(elem) => bool` module
// function, body `toBool(v)`. Nothing about the CONSTRUCTOR value changes:
// the identity block at the end is the control, and `opt.type === Boolean`
// still answers through the single interned `%builtin.Boolean`.
//
// A bool element is the second half. `toBool`'s operand domain is
// f64|string|union|ref precisely because a bool needs no conversion, so the
// pre-existing `.filter(Boolean)` path handed the validator a bool operand
// and raised an INTERNAL COMPILER ERROR (SC9001) rather than a fence:
//   in %arr.filterNarrow.0: toBool operand must be f64|string|union|ref, got bool
// The bools line below is that ICE, and it is a compile-time failure on base,
// not a trap.

const nums: number[] = [0, 1, 2, -0, NaN, 3];
const strs: string[] = ["", "a", "0"];
const bools: boolean[] = [false, true, false];
const opt: (string | undefined)[] = ["a", undefined, "", "b"];
const recs: { readonly k: number }[] = [{ k: 0 }, { k: 1 }];

console.log(nums.some(Boolean), nums.every(Boolean), nums.filter(Boolean).length);
console.log(nums.map(Boolean).join(","));
console.log(nums.find(Boolean), nums.findIndex(Boolean));
console.log(strs.some(Boolean), strs.every(Boolean), strs.filter(Boolean).length);
console.log(strs.map(Boolean).join(","));
console.log(bools.some(Boolean), bools.every(Boolean), bools.filter(Boolean).length);
console.log(bools.map(Boolean).join(","));
console.log(opt.some(Boolean), opt.every(Boolean), opt.filter(Boolean).length);
console.log(recs.some(Boolean), recs.every(Boolean), recs.filter(Boolean).length);

// Empty receivers: `some` is false and `every` is vacuously true.
const empty: number[] = [];
console.log(empty.some(Boolean), empty.every(Boolean), empty.filter(Boolean).length);

// zapo's own shape: a record of booleans, its values tested for "any set".
function computeDiff(a: number, b: number): { readonly lo: boolean; readonly hi: boolean } {
  return { lo: a < b, hi: a > b };
}
console.log(Object.values(computeDiff(1, 2)).some(Boolean));
console.log(Object.values(computeDiff(2, 2)).some(Boolean));

// THE CONTROL. `Boolean` as an ordinary VALUE keeps the interned coercion
// closure and its JS function identity, in the same program that just
// monomorphised it at three element types.
type Opt = { readonly name: string; readonly type: BooleanConstructor };
const table: Opt[] = [{ name: "v", type: Boolean }];
for (const o of table) {
  console.log(o.name, o.type === Boolean, o.type("x"), o.type(""));
}
const f = Boolean;
console.log(f === Boolean, f("x"), f(""));
console.log(nums.some(Boolean), f === Boolean, table[0]!.type === f);
