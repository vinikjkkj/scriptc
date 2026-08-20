// Two union arms with the SAME member NAME and DIFFERENT function
// signatures. Which arm a value takes has to be decided by the signature,
// and this program is here because the union arm walker now DECIDES while
// it BUILDS: one function replaced the matcher/builder pair, and the two
// halves it replaced did not agree about functions.
//
// The matcher tested `strcmp(sig)` — the exact interned signature — while
// the builder accepted ANY callable and wrapped a foreign one in an
// adapter. Behind a match the builder's permissive half was unreachable,
// so nobody had to care; merged into one walker it would have become the
// arm SELECTOR, and `{f: (x) => number} | {f: (x) => string}` would take
// arm 0 for a string-returning value and only notice inside the adapter,
// with the union already wearing the wrong tag. The merged walker keeps
// the PREDICATE's rule for exactly this reason.
//
// Node has no arms at all — `as` is erased and every call below is the
// call the value's own function makes — so Node's answer IS the answer,
// and a wrong arm shows up here as a different string or a throw.

type NumOp = { f: (x: number) => number };
type StrOp = { f: (x: number) => string };
type Op = NumOp | StrOp;

const strOp: StrOp = { f: (x: number) => "s" + x };
const numOp: NumOp = { f: (x: number) => x * 2 };

const uStr: unknown = strOp;
const uNum: unknown = numOp;

const backStr = uStr as Op;
const backNum = uNum as Op;

// Extracting the arm the value REALLY is: sound in Node (identity) and
// sound in scriptc only if the walker put the value on that arm.
console.log((backStr as StrOp).f(1));
console.log((backNum as NumOp).f(21));

// The same two values crossing again, and the two-arm order reversed for
// the second union so that "the first arm wins" cannot be right by
// accident for both.
type Op2 = StrOp | NumOp;
const again = uStr as Op2;
console.log((again as StrOp).f(7));
const again2 = uNum as Op2;
console.log((again2 as NumOp).f(3));

// A function arm standing alone, not inside a record: the same exact
// signature rule, one level up.
type Fn = (x: number) => string;
const fn: Fn = (x: number) => "fn" + x;
const uFn: unknown = fn;
const backFn = uFn as Fn | null;
console.log(backFn === null ? "null" : backFn(5));

// And the arm that is NOT the value's: a union that has no fitting arm
// refuses as a whole, which is the way to die the merge did not remove.
// Node throws nothing here, so the refusal is caught and only its shape
// is printed — the message text is scriptc's and stays out of stdout.
type Only = { g: (x: number) => number };
const uOnly: unknown = strOp;
let landed = "kept";
try {
  const bad = uOnly as Only;
  landed = "took-" + bad.g(1);
} catch {
  landed = "refused";
}
console.log(landed === "refused" || landed === "kept" ? "no-silent-arm" : landed);
