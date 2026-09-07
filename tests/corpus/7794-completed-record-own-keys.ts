// `{} as Record<K, V>` where V is REQUIRED — the accumulator spelling
// TypeScript forces on a bag keyed by a literal union, and the one zapo-js
// 1.8.2 writes for AB_PROP_CONFIGS. The literal names no field and the shape
// declares every one of them as required, so "absent" has no value to live
// in; the per-instance own-key mask carries it instead. What this program
// checks is that the mask and Node agree at every stage of filling one.

type Name = "alpha" | "beta" | "gamma";
interface Entry {
  readonly code: number;
  readonly kind: string;
}

const empty = {} as Record<Name, Entry>;
console.log("empty keys", JSON.stringify(Object.keys(empty)));
console.log("empty json", JSON.stringify(empty));
console.log("empty values", Object.values(empty).length);
console.log("empty entries", Object.entries(empty).length);
console.log("empty in", "alpha" in empty, "beta" in empty);

// Filled one key at a time, in the order the shape enumerates, so every
// intermediate state is observable and both sides must agree on all of them.
const bag = {} as Record<Name, Entry>;
bag.alpha = { code: 1, kind: "a" };
console.log("one keys", JSON.stringify(Object.keys(bag)));
console.log("one json", JSON.stringify(bag));
console.log("one in", "alpha" in bag, "gamma" in bag);
bag.beta = { code: 2, kind: "b" };
console.log("two keys", JSON.stringify(Object.keys(bag)));
console.log("two json", JSON.stringify(bag));
bag.gamma = { code: 3, kind: "c" };
console.log("all keys", JSON.stringify(Object.keys(bag)));
console.log("all json", JSON.stringify(bag));
console.log("all values", JSON.stringify(Object.values(bag).map((e) => e.code)));
console.log("all entries", JSON.stringify(Object.entries(bag).map((p) => p[0])));

// Reading a key the value does not have. In Node the read answers undefined
// and the property access on it throws a TypeError; scriptc throws at the
// read itself. Both sides reach the same catch with the same class, which is
// the only thing a required-typed read can be used for.
const half = {} as Record<Name, Entry>;
half.alpha = { code: 7, kind: "z" };
try {
  console.log("absent read", half.gamma.code);
} catch (e) {
  console.log("absent read threw TypeError", e instanceof TypeError);
}
console.log("absent survivor", half.alpha.code, JSON.stringify(Object.keys(half)));

// A required added field of every scalar-ish flavour the completion admits:
// a number, a string and a boolean, none of which has an undefined arm.
interface Scalars {
  readonly n: number;
  readonly s: string;
  readonly b: boolean;
}
const sc = {} as Scalars;
console.log("scalars keys", JSON.stringify(Object.keys(sc)));
console.log("scalars json", JSON.stringify(sc));
const sc2 = { n: 4 } as Scalars;
console.log("scalars partial keys", JSON.stringify(Object.keys(sc2)));
console.log("scalars partial json", JSON.stringify(sc2));

// The control: an ORDINARY literal of the same shape names every field, so
// it carries no mask at all and every surface answers exactly as it always
// has. Both constructions live in one program on purpose — the shape is
// shared, and only the instance knows which kind it is.
const whole: Record<Name, Entry> = {
  alpha: { code: 10, kind: "A" },
  beta: { code: 20, kind: "B" },
  gamma: { code: 30, kind: "C" },
};
console.log("whole keys", JSON.stringify(Object.keys(whole)));
console.log("whole json", JSON.stringify(whole));
console.log("whole read", whole.beta.code, whole.gamma.kind);

// Nested: a completed record held as a FIELD of another literal, and the
// enumeration of the outer one, so the walker meets the mask one level in.
const outer = { held: {} as Record<Name, Entry>, tag: "t" };
outer.held.beta = { code: 99, kind: "n" };
console.log("nested outer", JSON.stringify(outer));
console.log("nested inner keys", JSON.stringify(Object.keys(outer.held)));

// EVERY OTHER SURFACE THAT WALKS A RECORD'S FIELDS, on a value whose slots
// are not all written. Each of these read the slot before asking the mask,
// and the first three were an ACCESS VIOLATION rather than a wrong answer
// until the walkers learned to ask first.
const half2 = {} as Record<Name, Entry>;
half2.beta = { code: 8, kind: "h" };
console.log("inspect log:", half2);
const crossed: unknown = half2;
console.log("crossed", JSON.stringify(crossed));
const intoIndex: Record<string, Entry> = {};
Object.assign(intoIndex, half2);
console.log("assign keys", JSON.stringify(Object.keys(intoIndex)));
console.log("assign json", JSON.stringify(intoIndex));
const forInKeys: string[] = [];
for (const k in half2) forInKeys.push(k);
console.log("forin", JSON.stringify(forInKeys));
console.log("hasOwn", Object.hasOwn(half2, "beta"), Object.hasOwn(half2, "gamma"));
console.log("in", "beta" in half2, "gamma" in half2);
const nestedInArray = [half2];
console.log("in array", JSON.stringify(nestedInArray));
const byMap = new Map<string, Record<Name, Entry>>();
byMap.set("k", half2);
console.log("through a map", JSON.stringify(Object.keys(byMap.get("k")!)));
function throughAParam(x: Record<Name, Entry>): string {
  return JSON.stringify(Object.keys(x));
}
console.log("through a param", throughAParam(half2));

// ONE SHAPE REACHED BOTH WAYS in one program: completed by a literal here,
// materialised out of a dynamic value there. The mask carries both facts
// and the READ is where they part - a crossed value's clear bit means the
// source inherited the member and the slot holds what JS returns, so only
// the completed one may refuse.
interface Pair {
  readonly code: number;
  readonly kind: string;
}
const completedPair = {} as Pair;
const rawPair: unknown = JSON.parse('{"code":9,"kind":"k"}');
const crossedPair = rawPair as Pair;
console.log("completed pair keys", JSON.stringify(Object.keys(completedPair)));
console.log("crossed pair keys", JSON.stringify(Object.keys(crossedPair)));
console.log("crossed pair read", crossedPair.code, crossedPair.kind);
console.log("crossed pair json", JSON.stringify(crossedPair));
console.log("crossed pair log:", crossedPair);
console.log("in both", "code" in completedPair, "code" in crossedPair);

// A completed record with EVERY field absent still renders as Node renders
// an empty object. The framing used to reserve a space for a first entry
// that the mask then skipped, so this printed "{  }".
console.log("all absent log:", completedPair);
console.log("all absent json", JSON.stringify(completedPair));

// A completed record nested inside another completed record.
interface Leaf { readonly n: number }
interface Branch { readonly a: Leaf; readonly b: Leaf }
const leaf = {} as Leaf;
const branch = { a: leaf } as Branch;
console.log("branch keys", JSON.stringify(Object.keys(branch)));
console.log("branch json", JSON.stringify(branch));
console.log("branch log:", branch);

// A completed record that is filled and then RE-read by name many times:
// the bit is set once by the write and stays set.
const again = {} as Record<Name, Entry>;
again.gamma = { code: 5, kind: "g" };
let total = 0;
for (let i = 0; i < 3; i++) total += again.gamma.code;
console.log("repeat read", total, JSON.stringify(Object.keys(again)));
