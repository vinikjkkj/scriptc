// `o.hasOwnProperty(k)` reached through a receiver the compiler cannot
// type -- protobufjs's `util.isset` is
// `!(null == n || !e.hasOwnProperty(t)) && ...`, and it refused on the
// NAME: `hasOwnProperty` sat in the set of names a dyn-representable
// prototype declares. The STATIC spelling of the same question,
// `Object.hasOwn(o, k)`, has lowered for as long as the checked-dynamic
// tree has existed -- so the capability was there and only the method
// spelling could not reach it.
//
// Both spellings run one body now, and this program asserts they agree on
// every dyn kind. Where they DIFFER is the lookup, not the answer: the
// method form is a property read first, so an own member shadows it and a
// null-prototype dictionary has no such method at all.

function has(o, k) {
  return o.hasOwnProperty(k);
}
function both(label, o, k) {
  var a;
  try {
    a = String(has(o, k));
  } catch (e) {
    a = e.name + ": " + e.message;
  }
  var b;
  try {
    b = String(Object.hasOwn(o, k));
  } catch (e) {
    b = e.name + ": " + e.message;
  }
  console.log(label, a, a === b ? "(agree)" : "(DIFFER: " + b + ")");
}

// --- plain objects: own, inherited, absent, undefined-valued ------------
function Base() {
  this.own = 1;
}
Base.prototype.inherited = 2;
var inst = new Base();

both("own      ", inst, "own");
both("inherited", inst, "inherited");
both("absent   ", inst, "nope");
both("undefVal ", { u: undefined }, "u");
both("numKey   ", { 3: "three" }, 3);
both("numKeyStr", { 3: "three" }, "3");
both("missArg  ", { undefined: "u" }, undefined);

// --- a NON-ENUMERABLE own property: hasOwn differs from Object.keys -----
var hidden = {};
Object.defineProperty(hidden, "secret", { value: 9, enumerable: false });
both("hidden   ", hidden, "secret");
console.log("keys     ", JSON.stringify(Object.keys(hidden)));

// --- arrays: indices and length -----------------------------------------
var arr = ["a", "b", "c"];
both("arr idx  ", arr, "1");
both("arr oob  ", arr, "9");
both("arr len  ", arr, "length");
both("arr lead0", arr, "01");
both("arr neg  ", arr, "-1");

// --- strings: indices AND length are own --------------------------------
both("str idx  ", "abc", "1");
both("str oob  ", "abc", "5");
both("str len  ", "abc", "length");

// --- typed arrays: indices are own, length is NOT -----------------------
var u8 = new Uint8Array([7, 8, 9]);
both("u8 idx   ", u8, "1");
both("u8 oob   ", u8, "9");
both("u8 len   ", u8, "length");

// --- scalars box, and a box owns nothing --------------------------------
both("num      ", 5, "x");
both("bool     ", true, "x");

// --- functions: name/length are own, the property table too -------------
function named(a, b) {
  return a + b;
}
named.tag = "T";
both("fn name  ", named, "name");
both("fn length", named, "length");
both("fn own   ", named, "tag");
both("fn absent", named, "zzz");

// --- nullish receivers throw, and the two spellings throw DIFFERENTLY:
// the method form reads the property first (V8's "Cannot read properties
// of null"), the static form converts the argument (ToObject's message).
function shows(f) {
  try {
    return "ok:" + f();
  } catch (e) {
    return e.name + ": " + e.message;
  }
}
// (through JSON.parse, so the nullish value is a checked-dynamic one --
// a LITERAL null argument is a static type the Object.hasOwn lowering
// declines, which is a different refusal and not this one.)
var nul = JSON.parse("null");
var und = JSON.parse('{"x":1}').missing;
console.log("null m   ", shows(function () { return has(nul, "a"); }));
console.log("null s   ", shows(function () { return Object.hasOwn(nul, "a"); }));
console.log("undef m  ", shows(function () { return has(und, "a"); }));
console.log("undef s  ", shows(function () { return Object.hasOwn(und, "a"); }));

// --- the LOOKUP half: an own member shadows Object.prototype's ----------
var shadowFn = { hasOwnProperty: function (k) { return "mine:" + k; } };
console.log("shadowFn ", shows(function () { return has(shadowFn, "a"); }));
var shadowVal = { hasOwnProperty: 5 };
console.log("shadowVal", shows(function () { return has(shadowVal, "a"); }));

// A null-prototype dictionary inherits NOTHING -- this is exactly the
// shape protobufjs uses for its listener maps, and the reason the method
// form cannot be folded to the static one.
var dict = Object.create(null);
dict.k = 1;
console.log("nullproto", shows(function () { return has(dict, "k"); }));
console.log("nullstat ", shows(function () { return Object.hasOwn(dict, "k"); }));

// (A boxed CLASS INSTANCE is deliberately absent from this program: the
// box carries no member table, so both spellings take the loud ladder
// every other property question on it takes -- a REFUSAL, not an answer,
// and therefore not something a byte-exact program can hold. It is
// pinned in tests/harness/dyn-dispatch-accounting.test.ts instead.)

// --- the isset shape this came from -------------------------------------
function isset(obj, prop) {
  var v = obj[prop];
  return !(v == null || !obj.hasOwnProperty(prop)) && (typeof v !== "object" || (Array.isArray(v) ? v.length : Object.keys(v).length) > 0);
}
var msg = { a: 1, b: null, c: [], d: [1], e: {}, f: { g: 1 }, h: "" };
var out = [];
for (var i = 0; i < "abcdefh".length; i++) {
  var k = "abcdefh".charAt(i);
  out.push(k + "=" + isset(msg, k));
}
out.push("missing=" + isset(msg, "zz"));
console.log("isset    ", out.join(" "));
