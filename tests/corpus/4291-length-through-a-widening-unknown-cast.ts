// `.length` READ through a receiver the checker types `readonly unknown[]`
// (or `unknown[]`) — a WIDENING `as` over a real static array. The sibling of
// 4251, one level in: 4251 is the array METHOD dispatch, this is the member
// read.
//
// `readonly unknown[]` maps to `dyn` WHOLE (not to an array of dyn), so the
// mapped receiver never reaches the array tables. The read path already has
// the gate for exactly this shape and already lowers the receiver inside it —
// it just handled only the `dyn` outcome and DISCARDED a static-array probe,
// so the read fell out to the last-resort fence with
// `SC1090 reading 'length' from a value of type 'readonly unknown[]'`.
//
// The value is not dynamic: the `as` is erased at run time and the receiver
// lowers to a real `array<string>`, so the ordinary array intrinsic answers
// exactly what Node answers.
//
// The read surface is complete, and it comes from Node rather than from the
// compiler: `Object.getOwnPropertyNames([])` is exactly `["length"]`, and on a
// populated array the only additions are the index keys. Everything else an
// array answers lives on Array.prototype and is a method (4251's rule).
//
// CONTROLS that compiled all along and must keep answering identically:
//   - a receiver whose value really IS dynamic (keeps the dyn dispatch)
//   - a TUPLE receiver behind the same cast (probes to dyn, not to an array)
//   - the same expression with the cast REMOVED
//   - the receiver bound to an annotated local first
//   - `?.length` through a nullable widened receiver

// --- the row: `readonly unknown[]` ------------------------------------------
function widenedLength(xs: readonly string[], c: boolean): number {
  return (c ? (xs as readonly unknown[]) : []).length;
}
console.log("ro:", widenedLength(["a", "b"], true), widenedLength(["a", "b"], false));
console.log("ro-empty:", widenedLength([], true), widenedLength([], false));

// --- the same row, MUTABLE spelling: `unknown[]` -----------------------------
function widenedMutableLength(xs: string[], c: boolean): number {
  return (c ? (xs as unknown[]) : []).length;
}
console.log("mut:", widenedMutableLength(["a", "b", "c"], true), widenedMutableLength(["a"], false));

// --- zapo's own spelling (WaProfileCoordinator.ts:400), read instead of ------
// --- called: the Array.isArray ternary, with `.length` off the widening ------
export type MexUsernameCheck = {
  readonly xwa2_username_check?: {
    readonly result?: "SUCCESS";
    readonly suggestions?: ReadonlyArray<string>;
  };
};

function suggestionCount(data: MexUsernameCheck | null): number {
  const check = data?.xwa2_username_check;
  return (Array.isArray(check?.suggestions) ? (check.suggestions as readonly unknown[]) : []).length;
}
console.log("mex-null:", suggestionCount(null));
console.log("mex-empty:", suggestionCount({}));
console.log("mex-nocheck:", suggestionCount({ xwa2_username_check: {} }));
console.log(
  "mex-three:",
  suggestionCount({
    xwa2_username_check: { result: "SUCCESS", suggestions: ["alfa", "bravo", "charlie"] },
  }),
);
console.log(
  "mex-emptylist:",
  suggestionCount({ xwa2_username_check: { result: "SUCCESS", suggestions: [] } }),
);

// --- the length in an ARITHMETIC context (it must be a real number) ----------
function halfLength(xs: readonly string[], c: boolean): number {
  return (c ? (xs as readonly unknown[]) : []).length / 2 + 1;
}
console.log("arith:", halfLength(["a", "b", "c", "d"], true), halfLength(["a", "b"], false));

// --- the length as a LOOP bound ----------------------------------------------
function joinByIndex(xs: readonly string[], c: boolean): string {
  const w = c ? (xs as readonly unknown[]) : [];
  let out = "";
  for (let i = 0; i < w.length; i++) out += `${i}`;
  return out;
}
console.log("loop:", joinByIndex(["a", "b", "c"], true), "|", joinByIndex(["a", "b", "c"], false));

// --- CONTROL: a receiver whose value really IS dynamic -----------------------
// `readonly unknown[]` all the way down: nothing to adopt, the dyn keyed read
// keeps answering, and the answer is Node's.
function reallyUnknownLength(xs: readonly unknown[], c: boolean): number {
  return (c ? xs : []).length;
}
console.log("reallydyn:", reallyUnknownLength(["a", 1, "b"], true), reallyUnknownLength(["a", 1], false));

// --- CONTROL: a TUPLE behind the same cast -----------------------------------
// The probe answers `dyn` here, not an array, so this keeps the dyn arm and
// never hands an array intrinsic a record.
function tupleLength(t: readonly [string, number], c: boolean): number {
  return (c ? (t as readonly unknown[]) : []).length;
}
console.log("tuple:", tupleLength(["a", 1], true), tupleLength(["a", 1], false));

// --- CONTROL: the cast removed (compiled before this rule and still does) ----
function noCastLength(xs: readonly string[], c: boolean): number {
  return (c ? xs : []).length;
}
console.log("nocast:", noCastLength(["a", "b"], true), noCastLength(["a", "b"], false));

// --- CONTROL: the receiver bound to an annotated local first -----------------
function boundLocalLength(xs: readonly string[], c: boolean): number {
  const src: readonly unknown[] = c ? (xs as readonly unknown[]) : [];
  return src.length;
}
console.log("boundlocal:", boundLocalLength(["a", "b", "c"], true), boundLocalLength(["a"], false));

// --- CONTROL: `?.length` through a nullable widened receiver -----------------
function optionalLength(xs: readonly string[] | null, c: boolean): number {
  const w = c ? (xs as readonly unknown[] | null) : [];
  return w?.length ?? -1;
}
console.log("optional:", optionalLength(["a", "b"], true), optionalLength(null, true), optionalLength(["a"], false));

// --- evaluate-once: the receiver expression must run exactly once ------------
let effects = 0;
function pick(xs: readonly string[]): readonly string[] {
  effects += 1;
  return xs;
}
const n = (true ? (pick(["x", "y", "z"]) as readonly unknown[]) : []).length;
console.log("effects:", effects, "n:", n);
