// A DEFERRED CALL'S REFERENCE ARGUMENT IS THE VERY OBJECT, NOT A COPY.
//
// Every deferral surface here — `process.nextTick(cb, ...args)`,
// `setImmediate(cb, ...args)`, `setTimeout(cb, ms, ...args)` — ends at a
// runtime queue holding ONE zero-argument closure, so an argument is
// something the closure CAPTURED. There are two ways to capture it, and
// only one of them is Node:
//
//   * the DYN thunk boxes the callback and every argument and delivers a
//     `dynCall` at fire time. Boxing a reference COPIES it: `dynFrom` of an
//     array builds a fresh SCR_DYN_ARR.
//   * the TYPED thunk captures each argument AT ITS OWN TYPE and calls the
//     callback through `callValue` at its real signature. A reference stays
//     the reference.
//
// The dyn thunk used to be preferred, with the typed one kept only as the
// FALLBACK for callbacks the dyn boundary could not express — so the shapes
// that COULD box got the copy and the shapes that could NOT got the right
// answer. 2734 pins the second half and passed for that reason. This file
// pins the first half, and it FAILED before the preference was reversed:
// every `=== ` below answered `false` and every length was the pre-mutation
// one.
//
// Node's contract is plain: nothing is serialised, nothing is snapshotted.
// The mutations below all happen AFTER the deferral and BEFORE the callback
// runs, so a copy and a reference give different numbers, and identity says
// which one arrived.
const out: string[] = [];

// 1. nextTick, an ARRAY, mutated after the deferral.
const xs: number[] = [1, 2];
process.nextTick((n: number, a: number[]): void => {
  out.push(`tick ${n} ${a.length} ${a === xs}`);
}, 0, xs);
xs.push(3);

// 2. setImmediate, a RECORD, a field written after the deferral.
const bag: { n: number } = { n: 1 };
setImmediate((b: { n: number }): void => {
  out.push(`imm ${b.n} ${b === bag}`);
}, bag);
bag.n = 2;

// 3. setTimeout, a CLASS INSTANCE — the case the dyn box does carry by
//    reference, so this one is the control: it must have been right before
//    and must still be right.
class Token {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
}
const tok = new Token(1);
setTimeout((t: Token): void => {
  out.push(`timeout ${t.n} ${t === tok}`);
}, 0, tok);
tok.n = 2;

// 4. A MAP, whose entries are written after the deferral. A Map crossing
//    into dyn is carried by reference too, so this is a second control —
//    and it is the one that would have gone wrong the OTHER way if the
//    typed thunk had been made to copy.
const seen = new Map<string, number>();
process.nextTick((m: Map<string, number>): void => {
  out.push(`map ${m.size} ${m === seen}`);
}, seen);
seen.set("k", 1);

// 5. Extra arguments past the parameter list still EVALUATE and are then
//    dropped, which is JS's arity rule and not a shortcut either thunk may
//    take.
let bumped = 0;
const bump = (): number[] => {
  bumped++;
  return xs;
};
process.nextTick((a: number[]): void => {
  out.push(`extra ${a === xs} bumped=${String(bumped)}`);
}, xs, bump());

// THE FLUSH IS ORDERING-PROOF, AND IT HAS TO BE. `setImmediate` (check
// phase) and a small `setTimeout` (timers phase) scheduled from the same
// top-level tick have NO defined order in Node — the first run of this file
// printed the `imm` line on three of four executions and dropped it on the
// fourth, which is a flake, not a finding. This file is about WHAT each
// callback received, never about when; 2734 is the one that pins ordering.
// So the flush waits long enough for the check phase to have run, and the
// lines are SORTED before printing: each is uniquely prefixed, so the sort
// is total and the interleaving cannot be observed.
setTimeout(() => {
  console.log(out.slice().sort().join(" | "));
}, 50);
