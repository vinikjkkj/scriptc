// `"k" in record` where the record carries an INDEX SIGNATURE. The runtime-
// keyed form (`k in record`, k a string variable) has always compiled — it
// takes an interned presence helper that walks the declared names and then
// the overflow map's live keys. The LITERAL-keyed form, which is the same
// question with the string written down, fenced instead, and the fence's
// hint sent the author to `!== undefined` — which on exactly these reads was
// a constant fold, so the recommended spelling compiled to `true`.
//
// Both spellings now take the same helper. `in` and `!== undefined` are NOT
// the same test and the difference shows here: a key held with an explicit
// `undefined` value is PRESENT (`in` true) but reads as undefined, and the
// two answers below disagree on exactly those entries — as they do in Node.
//
// Everything below is behaviour Node and scriptc AGREE on.

type Strs = Readonly<Record<string, string>>;
type Unks = Readonly<Record<string, unknown>>;
type Opts = Readonly<Record<string, string | undefined>>;

const strs: Strs = { k: "v", empty: "" };
const unks: Unks = { held: undefined, num: 1 };
const opts: Opts = { held: undefined, str: "x" };

// 1. The plain presence question, literal key, against the runtime-keyed
//    spelling of the same question — they must agree.
const runtimeK = "k";
console.log("lit", "k" in strs, "runtime", runtimeK in strs);
console.log("lit-empty", "empty" in strs, "lit-absent", "gone" in strs);

// 2. Where `in` and `!== undefined` legitimately differ: a key HELD with an
//    undefined value. Present, and undefined.
console.log("unk held in", "held" in unks, "read", unks.held !== undefined);
console.log("unk num in", "num" in unks, "read", unks.num !== undefined);
console.log("unk absent in", "gone" in unks, "read", unks.gone !== undefined);
console.log("opt held in", "held" in opts, "read", opts.held !== undefined);
console.log("opt str in", "str" in opts, "read", opts.str !== undefined);
console.log("opt absent in", "gone" in opts, "read", opts.gone !== undefined);

// 3. Declared fields ALONGSIDE a signature: the declared name answers from
//    the shape, the overflow name from the map.
interface Hybrid {
  readonly tag: string;
  readonly [k: string]: string;
}
const hy: Hybrid = { tag: "t", extra: "e" };
console.log("hybrid", "tag" in hy, "extra" in hy, "gone" in hy);

// 4. A mutable record across write and delete.
const grow: Record<string, string> = {};
console.log("grow before", "k" in grow);
grow.k = "x";
console.log("grow after", "k" in grow);
delete grow.k;
console.log("grow deleted", "k" in grow);

// 5. Negation, composition, and the guard shape the idiom exists for.
if (!("gone" in strs)) {
  console.log("negated ok");
}
console.log("composed", "k" in strs && "empty" in strs, "k" in strs || "gone" in strs);
function pick(m: Strs, key: string): string {
  return key in m ? m[key] : "default";
}
console.log(pick(strs, "k"), pick(strs, "gone"));

// 6. Counted over a loop, so the interned helper is exercised repeatedly.
let found = 0;
for (const key of ["k", "empty", "gone", "tag", "k"]) {
  if (key in strs) {
    found++;
  }
}
console.log("found", found);
