// A comma-separated declarator list, a statement-position comma chain and a
// comma sequence in an assignment's right-hand side are all several
// independently sequenced parts wearing ONE statement's syntax. Deferred-fence
// lowering now gives each part its own poison window, so one part's refusal no
// longer costs its siblings — the shape minifiers produce, and the shape
// zapo's shipped 1.87 MB protobuf bundle is written in end to end.
//
// Splitting the WINDOW is only sound if it never moves, duplicates or drops an
// effect, so this pins the SEQUENCING itself: every initialiser and every
// comma operand here is effectful and order-sensitive. A JavaScript entry on
// purpose — deferred fences are what the rule is gated on, and a .js corpus
// program is the lane that has them without --best-effort.

let log = "";
/** @param {string} tag @param {number} v @returns {number} */
function eff(tag, v) {
  log += tag;
  return v;
}
/** @param {string} tag @returns {number} */
function boom(tag) {
  log += tag;
  throw new Error("boom");
}

// Declarators run left to right, and a later initialiser sees the earlier
// bindings — the reason the parts cannot be reordered.
const a = eff("a", 1), b = eff("b", a + 1), c = eff("c", b + 1);
console.log(a, b, c, log);

// `let` and `var` ride the same path; `var` hoists its slot but still assigns
// in source order.
log = "";
let p = eff("p", 10), q = eff("q", p * 2);
var r = eff("r", q + 1), s = eff("s", r + 1);
console.log(p, q, r, s, log);

// A declarator whose initialiser THROWS stops the list where JS stops it: the
// earlier binding is initialised, the later one never runs.
log = "";
let reached = "none";
try {
  const u = eff("u", 1), v = boom("v"), w = eff("w", v);
  reached = "all" + String(u) + String(w);
} catch {
  reached = "caught";
}
console.log(reached, log);

// Statement-position comma: both operands run for effect in source order and
// both values are discarded.
log = "";
let acc = 0;
/** @param {string} tag @param {number} n @returns {number} */
function bump(tag, n) {
  log += tag;
  acc += n;
  return acc;
}
bump("1", 1), bump("2", 2), bump("3", 3);
console.log(acc, log);

// A chain is left-associated and parentheses are transparent — the leaf
// sequence is what matters, and it is the same either way.
log = "";
acc = 0;
(bump("x", 4), bump("y", 5)), bump("z", 6);
console.log(acc, log);

log = "";
acc = 0;
bump("i", 1), (bump("j", 2), bump("k", 3));
console.log(acc, log);

// A throwing operand stops the chain exactly where JS stops it.
log = "";
acc = 0;
try {
  bump("m", 1), boom("n"), bump("o", 100);
} catch {
  log += "!";
}
console.log(acc, log);

// Comma in a for-incrementor and a declarator list inside a loop body.
log = "";
let i = 0;
let j = 10;
for (; i < 3; i++, j--) {
  const d1 = eff("d", i), d2 = eff("e", j);
  log += String(d1) + String(d2);
}
console.log(i, j, log);

// `x = (a, b, v)` in statement position: the effects lift out of the comma and
// the assignment takes the TAIL. Each effect must run EXACTLY ONCE (lifting
// the left operand out of a comma is a double-run hazard), in order, and the
// assigned value must be the last operand.
log = "";
let v1 = 0;
v1 = (eff("A", 1), eff("B", 2), eff("C", 3));
console.log(v1, log);

// the same over a property target whose base is a `var`...
log = "";
var bag = { k: 0 };
bag.k = (eff("D", 1), eff("E", 2), eff("F", 9));
console.log(bag.k, log);

// ...and nested, where the tail is itself a chain.
log = "";
v1 = (eff("G", 1), (eff("H", 2), eff("I", 7)));
console.log(v1, log);

// THE ORDER THE RULE MUST NOT BREAK. JS evaluates the assignment TARGET's
// reference BEFORE the right-hand side, so a target whose base or key has an
// effect can never be lifted past the operands. This is the shape the rule
// refuses, and the log is the proof: `P` comes FIRST.
log = "";
const arr = [0, 0, 0];
/** @returns {number} */
function pick() {
  log += "P";
  return 1;
}
arr[pick()] = (eff("J", 1), eff("K", 5));
console.log(arr.join("/"), log);

// A throwing effect stops the chain and leaves the target unwritten.
log = "";
let v2 = 111;
try {
  v2 = (eff("L", 1), boom("M"), eff("N", 2));
} catch {
  log += "!";
}
console.log(v2, log);

// A single-declarator statement and a non-comma expression statement are
// untouched by the rule; they still lower and run identically.
const only = eff("z", 42);
console.log(only, log.length);
