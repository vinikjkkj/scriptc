// A class instance and a symbol cross into the embedded engine in the SAME program: the instance runs on itself, the symbol is one
// identity on both sides, and an object carrying a symbol-keyed property crosses beside the instance.
"use strict";
class Box {
  constructor() { this.n = 1; }
  get() { return this.n; }
  bump() { this.n++; return this.n; }
}
const kA = Symbol("a");
const kReg = Symbol.for("shared");
const OFFN = 99;
const b = new Box();
const body = ["b.n = b.n + 1;", "return [b.get(), b.bump(), typeof k, k.description, k === k2, Symbol.keyFor(r), r === Symbol.for('shared')].join('|');"];
const run = new Function("b", "k", "k2", "r", body.map((_, i) => (process.argv.length > OFFN ? "" : body[i])).join("\n"));
console.log(run(b, kA, kA, kReg));
console.log(b.n);
const rt = JSON.parse('{"n":1}');
rt[kA] = "sym-value";
const body2 = ["return [o[k], k in o, Object.getOwnPropertySymbols(o).length, b.get(), b.n].join('|');"];
const peek = new Function("o", "b", "k", body2.map((_, i) => (process.argv.length > OFFN ? "" : body2[i])).join("\n"));
console.log(peek(rt, b, kA));
const body3 = ["const s = Symbol('made'); return { s, same: s === s, who: b };"];
const make = new Function("b", body3.map((_, i) => (process.argv.length > OFFN ? "" : body3[i])).join("\n"));
const made = make(b);
console.log(typeof made.s, made.same, made.who === b, made.s === made.s);
