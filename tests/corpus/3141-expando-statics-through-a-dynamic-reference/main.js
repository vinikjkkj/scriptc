// Expando statics of a TOP-LEVEL function, reached through a DYNAMIC
// reference to the function value.
//
// `function F(){}; F.alloc = fn` at module scope does not store into the
// function value's own-property table the way a NESTED declaration does
// (corpus 2761): the compiler lifts each member to a typed module global
// keyed by (function symbol × member key) and routes the NAME-spelled
// read and write straight at it (lower-expando.ts). Nothing about that
// global is visible to a FUNC dyn box, whose property table hangs off the
// closure — so before the accessor binding this file exercises, every
// route below answered `undefined` (or threw the checked conversion on
// the way out of one), and a WRITE through any of them landed in the
// table where no name-spelled read could ever see it. Two storages for
// one JavaScript fact, disagreeing in both directions; Node has one.
//
// Every escape route measured on the base tree is here, reads AND writes:
// an object property, an array element, a parameter, a local alias, a
// returned value, an identity call, `F.prototype.constructor`, `new F()
// .constructor`, a callback, and — across a module edge — the CJS export
// table and an alias taken off it. The write half matters most: a value
// written through one spelling has to be what EVERY other spelling reads
// next, which is the invariant a second storage cannot have.
//
// `Object.keys(F)` / `"k" in F` are deliberately absent: both are fenced
// on function receivers by the static tier for reasons of their own, and
// a fixture that tripped them would test the fence, not this.
"use strict";

import codec from "./codec.cjs";

function Writer(len) {
  this.len = len;
}
Writer.TAG = "w";
Writer.count = 0;
Writer.opts = { deep: "d" };
Writer.alloc = function (n) {
  return "alloc:" + n;
};

// The control: the name-spelled read the module global has always served.
console.log("name  ", Writer.TAG, Writer.count, Writer.opts.deep, Writer.alloc(1));

// ── reads, one per escape route ──────────────────────────────────────
const holder = {};
holder.f = Writer;
const arr = [Writer];
const alias = Writer;
function idn(x) {
  return x;
}
function get() {
  return Writer;
}
function viaParam(g) {
  return g.TAG + "/" + g.alloc(2);
}

console.log("prop  ", holder.f.TAG, holder.f.opts.deep, holder.f.alloc(3));
console.log("elem  ", arr[0].TAG, arr[0].alloc(4));
console.log("alias ", alias.TAG, alias.alloc(5));
console.log("param ", viaParam(Writer));
console.log("ret   ", get().TAG, idn(Writer).TAG);
console.log("proto ", Writer.prototype.constructor.TAG, Writer.prototype.constructor.alloc(6));
console.log("inst  ", new Writer(1).constructor.TAG);
console.log("typeof", typeof holder.f.TAG, typeof holder.f.count, typeof holder.f.nosuch);
console.log(
  "cb    ",
  [Writer].map(function (f) {
    return f.TAG;
  })[0],
);

// ── writes: one storage, or the spellings drift apart ────────────────
holder.f.TAG = "W";
console.log("w-box ", Writer.TAG, holder.f.TAG, arr[0].TAG, alias.TAG);

Writer.count = 7;
console.log("w-name", Writer.count, holder.f.count, arr[0].count);

// A read-modify-write through the box, read back through the name.
holder.f.count = holder.f.count + 1;
console.log("w-rmw ", Writer.count, holder.f.count);

// A member the box invents: no global exists for it, so the own-property
// table is its home — and it must not disturb the bound ones.
holder.f.fresh = "n";
console.log("w-new ", holder.f.fresh, arr[0].fresh, Writer.TAG);

// A FUNCTION-valued static replaced through a box, then called through
// the name: the call has to reach the new value.
holder.f.alloc = function (n) {
  return "ALLOC:" + n;
};
console.log("w-fn  ", Writer.alloc(8), holder.f.alloc(9));

// ── the same, across a module edge ───────────────────────────────────
console.log("x-tbl ", codec.parse.VERSION, codec.parse("abcd"));
const p = codec.parse;
console.log("x-alias", p.VERSION, p.hits);
p.hits = p.hits + 2;
console.log("x-write", codec.parse.hits, p.hits);
codec.parse.VERSION = "2.0.0";
console.log("x-back ", p.VERSION, codec.parse.VERSION);

// ── a module-level callable CONST carries members the same way ───────
const conv = function (x) {
  return x + 1;
};
conv.unit = "u";
const cbox = {};
cbox.c = conv;
console.log("const ", conv.unit, cbox.c.unit, cbox.c(1));
cbox.c.unit = "v";
console.log("constw", conv.unit, cbox.c.unit);
