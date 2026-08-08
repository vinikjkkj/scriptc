// `delete o[k]` over a checked-dynamic receiver — the operator, and the
// BOOLEAN it evaluates to.
//
// delete is an operator in JavaScript, not a statement form, and a
// minifier makes that visible: terser rewrites `if (c) delete o[k]` into
// `c && delete o[k]`, so the delete lands in the right operand of `&&`
// and needs a value. That rewrite is exactly what pbjs's `oneOfSetter`
// ships as — the setter that clears an object's other oneof fields — and
// it is the only delete in a 1.8 MB generated codec.
//
// The answer is not always true. JS's [[Delete]] is an OWN-property
// operation: a missing name answers true without touching the prototype
// chain, and a configurable own property is removed and answers true. A
// NON-configurable one is where the two language modes part — sloppy
// mode answers false, strict mode throws — and a module is strict, so
// the throw is what this program pins. Data members and accessor
// properties live in two separate tables here (an accessor defined
// without `enumerable` must not appear in Object.keys), so the delete
// has to drop from whichever one holds the key.
//
// A JavaScript entry: an untyped receiver only exists in JS.

// ── the answer, in value position ───────────────────────────────────────
var o = JSON.parse('{"a":1,"b":2,"c":3}');
console.log(delete o.a, JSON.stringify(o));
// A name that was never there is still true, and removes nothing.
console.log(delete o.zzz, JSON.stringify(o));
// The bracket spelling, a literal key and a computed one.
console.log(delete o["b"], JSON.stringify(o));
var k = "c";
console.log(delete o[k], JSON.stringify(o), Object.keys(o).length);

// Deleting twice: the second is still true.
var twice = JSON.parse('{"x":1}');
console.log(delete twice.x, delete twice.x, JSON.stringify(twice));

// Property keys are STRINGS, so a number key stringifies like an index
// read does.
var numbered = JSON.parse('{"0":"a","1":"b","10":"c"}');
console.log(delete numbered[0], delete numbered[10], JSON.stringify(numbered));

// ── the positions a value-less delete could not reach ───────────────────
var g = JSON.parse('{"p":1,"q":2,"r":3}');
// the right operand of && (terser's `if (c) delete …`)
var cond = true;
cond && delete g.p;
console.log(JSON.stringify(g));
// a ternary arm, a comma operand, an argument, a condition
console.log(cond ? delete g.q : false, JSON.stringify(g));
var side = 0;
console.log((side++, delete g.r), JSON.stringify(g), side);
function tell(x) { return "answered " + String(x); }
var h = JSON.parse('{"s":1}');
console.log(tell(delete h.s), JSON.stringify(h));
if (delete h.nothing) console.log("a missing key deletes true");
console.log(!delete h.s, delete h.s === true);

// ── statement position keeps working, and agrees ────────────────────────
var st = JSON.parse('{"m":1,"n":2}');
delete st.m;
console.log(JSON.stringify(st));

// ── the pbjs oneOf setter, in its minified shape ────────────────────────
function Msg() { this.alpha = 1; this.beta = 2; this.gamma = 3; }
function oneOfSetter(fieldNames) {
  return function (name) {
    for (var i = 0; i < fieldNames.length; ++i) fieldNames[i] !== name && delete this[fieldNames[i]];
  };
}
var m = new Msg();
oneOfSetter(["alpha", "beta", "gamma"]).call(m, "beta");
console.log(JSON.stringify(m), Object.keys(m).join(","));
var m2 = new Msg();
// Setting a name nothing matches clears every one of them.
oneOfSetter(["alpha", "beta", "gamma"]).call(m2, "delta");
console.log(JSON.stringify(m2), Object.keys(m2).length);

// ── own-only: the prototype chain is never touched ──────────────────────
function Base() {}
Base.prototype.inherited = "from the prototype";
function Derived() { this.own = "mine"; }
Derived.prototype = new Base();
var d = new Derived();
console.log(d.own, d.inherited);
// Deleting the INHERITED name answers true and removes nothing — the
// property is still readable through the chain.
console.log(delete d.inherited, d.inherited);
console.log(delete d.own, String(d.own), d.inherited);

// ── accessors: a separate table, and configurable decides ───────────────
var acc = JSON.parse('{"plain":1}');
Object.defineProperty(acc, "sealed", { get: function () { return "getter ran"; } });
Object.defineProperty(acc, "loose", {
  get: function () { return "loose getter"; },
  configurable: true,
});
console.log(acc.sealed, acc.loose);
// Neither accessor is an enumerable own key.
console.log(JSON.stringify(acc), Object.keys(acc).join(","));
// Configurable: true, and the property is gone.
console.log(delete acc.loose, String(acc.loose));
// A plain data member beside them is unaffected until deleted.
console.log(delete acc.plain, JSON.stringify(acc), "sealed" in acc, "loose" in acc);
// Non-configurable, in a MODULE: strict-mode [[Delete]] throws, and the
// getter is still there afterwards to prove nothing was removed.
try { delete acc.sealed; console.log("no throw"); } catch (e) { console.log(String(e)); }
console.log(acc.sealed, "sealed" in acc);
