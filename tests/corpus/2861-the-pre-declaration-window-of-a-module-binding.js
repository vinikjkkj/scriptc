// A module-scope binding's slot is empty until the init body reaches its
// declarator, and a function created ABOVE the declarator can read it
// there. Nothing can prove that read does not run, so the slot has to be
// honest about holding both states — and it was not. A pointer-backed
// global handed its NULL straight to a retain: SEGMENTATION FAULT, no
// diagnostic, on four lines of JavaScript that Node runs without comment.
//
// Both binding forms are here because JS gives them DIFFERENT answers in
// that window, and each answer has to be the language's own:
//
//   * a `var` is hoisted and holds `undefined` until its initialiser runs,
//     so an early read is `undefined` and never an error;
//   * a `let`/`const` is hoisted into its TEMPORAL DEAD ZONE, so an early
//     read is a catchable ReferenceError with a specific message.
//
// A JavaScript entry: `var` hoisting, and an untyped binding whose value
// is only known from its initialiser, exist only in JS.

// ── a `var` read above its declarator is `undefined` ────────────────────
// The four-line file that used to fault. `early` is created above the
// declarator, so its read of `later` runs in the window.
function early() { return later; }
console.log(String(early()));
var later = function () { return "later ran"; };
console.log(early()());

// CALLING through the window is Node's ordinary not-a-function TypeError,
// not a crash: the binding holds `undefined`, and `undefined()` throws.
function callThrough() { return viaCall(); }
try {
  callThrough();
  console.log("unreachable");
} catch (e) {
  console.log("call in the window: " + e.name);
}
var viaCall = function () { return "viaCall ran"; };
console.log(callThrough());

// The value's SHAPE does not change the rule. An object literal, an
// arrow, and a binding later reassigned back to `undefined` all read
// `undefined` above their declarators.
function readObj() { return obj; }
console.log(String(readObj()));
var obj = { a: 1, b: "two" };
console.log(JSON.stringify(readObj()));

function readArrow() { return arrow; }
console.log(String(readArrow()));
var arrow = () => "arrow ran";
console.log(readArrow()());

function readCycled() { return cycled; }
console.log(String(readCycled()));
var cycled = function () { return "cycled"; };
console.log(readCycled()());
cycled = undefined;
console.log(String(readCycled()));

// A `var` in a top-level BLOCK is module-scoped exactly like its
// top-level siblings, so it has the same window.
function readNested() { return nested; }
console.log(String(readNested()));
if (String(1) === "1") { var nested = function () { return "nested ran"; }; }
console.log(readNested()());

// ── a `let`/`const` read above its declarator is the TDZ ReferenceError ─
function readLet() { return tdzLet; }
try {
  readLet();
  console.log("unreachable");
} catch (e) {
  console.log("let in the window: " + e.name + ": " + e.message);
}
let tdzLet = function () { return "tdzLet ran"; };
console.log(readLet()());

function readConst() { return tdzConst; }
try {
  readConst();
  console.log("unreachable");
} catch (e) {
  console.log("const in the window: " + e.name + ": " + e.message);
}
const tdzConst = function () { return "tdzConst ran"; };
console.log(readConst()());

// ── the window is the ONLY thing that changed ───────────────────────────
// An ordinary declaration read only from below keeps its answer, and its
// representation: nothing here is in any window.
var settled = function () { return "settled"; };
function readSettled() { return settled; }
console.log(readSettled()());

const table = { one: 1, two: 2 };
function readTable() { return table.one + table.two; }
console.log(readTable());
