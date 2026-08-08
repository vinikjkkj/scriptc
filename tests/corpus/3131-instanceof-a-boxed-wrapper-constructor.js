// `x instanceof String` / `Number` / `Boolean` — the BOXED WRAPPER test,
// whose answer is a constant because the constructor that would make it
// true has no lowering.
//
// `new String(…)`, `new Number(…)` and `new Boolean(…)` are refused by name
// ("boxed wrapper objects have no lowering — use the string primitive"),
// everywhere except a ToString span where the wrapper collapses to its
// primitive before anything can observe it. So a wrapper OBJECT cannot
// exist in a compiled program, and for every value a compiled program CAN
// produce — primitive, record, array, class instance, function,
// checked-dynamic — Node answers false as well. The constant is licensed by
// that fence, not asserted: if `new String(…)` ever lowers, this answer has
// to stop being constant on the same day.
//
// The idiom that made this a blocker is protobufjs's `util.isString`:
//
//     util.isString = function (value) {
//       return typeof value === "string" || value instanceof String;
//     };
//
// `Writer.prototype.bytes` calls it for EVERY bytes field it encodes, so it
// is the first thing WhatsApp's noise handshake reaches once the generated
// codec is bound to its declaration twin — one `instanceof` standing in
// front of the entire protobuf surface.
//
// Every operand below is UNTYPED, which is not a convenience: tsc rejects
// `instanceof` outright on a statically primitive left-hand side (SC0001,
// "must be of type 'any', an object type or a type parameter"), so the only
// operand that can reach this lowering at all is a checked-dynamic one —
// exactly what a value crossing a generated module's boundary is.
//
// DELIBERATE DIVERGENCES, none printed:
//   * A COMPUTED left operand keeps a loud refusal. Folding to `false`
//     discards the operand's evaluation, and an operand with a side effect
//     has to run — so only a pure read folds, the same rule the class-target
//     and bytes-flavor folds already use. Binding the value to a variable
//     first is the supported spelling, and section 2 does exactly that.
//   * A boxed wrapper itself. `new String("a") instanceof String` is `true`
//     in Node and does not compile here at all — the constructor is fenced
//     one tier earlier, so this file cannot express the case, which is the
//     same reason the answer below is sound.

"use strict";

// Hands back its argument at `any`, which is what every value arriving from
// a generated CommonJS twin is worth.
function opaque(v) {
  return v;
}

// ── 1. protobufjs's util.isString, verbatim in shape ─────────────────
// The predicate the Writer runs per bytes field, plus its two siblings.
// A parameter read is the pure-read spelling that folds.
function isString(value) {
  return typeof value === "string" || value instanceof String;
}
function isNumber(value) {
  return typeof value === "number" || value instanceof Number;
}
function isBoolean(value) {
  return typeof value === "boolean" || value instanceof Boolean;
}

function probe(label, v) {
  console.log(label, isString(v), isNumber(v), isBoolean(v));
}

probe("string", "wa");
probe("empty string", "");
probe("number", 7);
probe("zero", 0);
probe("nan", NaN);
probe("true", true);
probe("false", false);
probe("null", null);
probe("undefined", undefined);
probe("object", { os: "Windows" });
probe("array", [1, 2, 3]);
probe("bytes", new Uint8Array([1, 2, 3]));
probe("function", isString);

// ── 2. the bare operator, and its negation ───────────────────────────
// The fold is on the operator, not on the `typeof || instanceof` idiom, so
// the operand alone answers — and `!` over it is the spelling the encoder
// actually branches on.
var s = opaque("ephemeral");
var n = opaque(32);
var b = opaque(true);
var o = opaque({ tag: "clientHello" });
console.log("bare", s instanceof String, n instanceof Number, b instanceof Boolean);
console.log("negated", !(s instanceof String), !(o instanceof String));
console.log("cross", s instanceof Number, n instanceof String, b instanceof String);

// A LOCAL bound from a computed expression is still a pure read at the
// operator, which is how an effectful operand is spelled.
var calls = 0;
function effectful() {
  calls++;
  return "counted";
}
var bound = opaque(effectful());
console.log("bound", bound instanceof String, calls);

// ── 3. through a checked-dynamic member read ─────────────────────────
// The operand the shipped bundle hands the predicate is a property of an
// untyped box, not a binding, so the answer has to hold one indirection
// further out too.
function dynHolder() {
  var box = {};
  box.s = "dyn-string";
  box.n = 5;
  box.b = false;
  box.o = { nested: true };
  box.u = new Uint8Array([9]);
  return opaque(box);
}
var d = dynHolder();
var ds = opaque(d.s);
var dn = opaque(d.n);
var db = opaque(d.b);
console.log("dyn s", isString(d.s), ds instanceof String);
console.log("dyn n", isNumber(d.n), dn instanceof Number);
console.log("dyn b", isBoolean(d.b), db instanceof Boolean);
console.log("dyn o", isString(d.o), isNumber(d.o));
console.log("dyn u", isString(d.u), isBoolean(d.u));

// ── 4. the encoder's own branch ──────────────────────────────────────
// `Writer.prototype.bytes` picks its path off the predicate: a string is
// latin1-decoded, anything else is copied. A wrong answer here does not
// throw, it writes the wrong bytes — which is why a silent `true` would be
// worse than the refusal this replaces.
function writeBytes(value) {
  if (isString(value)) {
    var out = [];
    for (var i = 0; i < value.length; i++) out.push(value.charCodeAt(i) & 0xff);
    return "str:" + out.join(".");
  }
  var copy = [];
  for (var j = 0; j < value.length; j++) copy.push(value[j]);
  return "buf:" + copy.join(".");
}
console.log(writeBytes(opaque("AB")));
console.log(writeBytes(opaque(new Uint8Array([1, 2, 3]))));
console.log(writeBytes(opaque([7, 8])));

// ── 5. the predicate still gates a branch ────────────────────────────
// A constantly-false arm is not a dead branch: the `typeof` arm in front of
// it is what decides, and the code after the test still reads the operand.
function describe(v) {
  if (isString(v)) return "s(" + String(v).length + ")";
  if (isNumber(v)) return "n(" + (Number(v) + 1) + ")";
  if (isBoolean(v)) return "b(" + (v ? 1 : 0) + ")";
  return "other";
}
console.log(
  describe(opaque("abc")),
  describe(opaque(41)),
  describe(opaque(true)),
  describe(opaque({})),
  describe(opaque(null)),
);

// ── 6. many operands, no state ───────────────────────────────────────
// The fold is per site and carries nothing across calls; 300 iterations
// answer the same as one, and the program ends holding nothing.
var trues = 0;
var falses = 0;
for (var k = 0; k < 300; k++) {
  var v = opaque(k % 3 === 0 ? "s" + k : k % 3 === 1 ? k : k % 2 === 0);
  if (v instanceof String || v instanceof Number || v instanceof Boolean) trues++;
  else falses++;
}
console.log("loop", trues, falses);

console.log("done");
