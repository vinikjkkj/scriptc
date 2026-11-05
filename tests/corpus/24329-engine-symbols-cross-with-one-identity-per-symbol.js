// Symbols cross the embedded-engine boundary as one symbol per identity in both directions, keep their registry and description, and their properties are read, written, listed, copied and marshalled.
"use strict";
const kA = Symbol("a"), kB = Symbol(), kEmpty = Symbol(""), kReg = Symbol.for("shared");
const OFFN = 99;
// 1. runtime symbols in, identity and distinctness kept (Symbol() vs Symbol("") stay apart; the registry is shared)
const p1 = ["const d = [typeof a, a.description, b.description, e.description, a === a, a === b, b === e].join('|');",
  "return d + '|' + (r === Symbol.for('shared')) + '|' + Symbol.keyFor(r) + '|' + String(a) + '|' + String(b);"];
const probe = new Function("a", "b", "e", "r", p1.map((_, i) => (process.argv.length > OFFN ? "" : p1[i])).join("\n"));
console.log(probe(kA, kB, kEmpty, kReg));
// 2. engine symbols out: one runtime symbol per engine identity, round trips back to the same engine symbol
const p2 = ["const s = Symbol('minted'); const t = Symbol.for('shared'); const w = Symbol.iterator;", "return { s, s2: s, t, w, u: Symbol('minted') };"];
const mint = new Function(p2.map((_, i) => (process.argv.length > OFFN ? "" : p2[i])).join("\n"));
const m = mint();
console.log(m.s === m.s2, m.s === m.u, m.t === kReg, typeof m.s, typeof m.w, m.w === m.s);
const p3 = ["const same = (x, y) => x === y;", "return same(a, b);"];
const same = new Function("a", "b", p3.map((_, i) => (process.argv.length > OFFN ? "" : p3[i])).join("\n"));
console.log(same(m.s, m.s2), same(m.s, m.u), same(m.t, kReg), same(m.w, m.w));
// 3. properties keyed by symbols on engine objects, read and written from the runtime side
const p4 = ["const o = { plain: 1 }; o[k] = 'init';", "Object.defineProperty(o, Symbol.for('hidden'), { value: 'h', enumerable: false });", "return o;"];
const mk = new Function("k", p4.map((_, i) => (process.argv.length > OFFN ? "" : p4[i])).join("\n"));
const o = mk(kA);
console.log(o[kA], kA in o, Object.hasOwn(o, kA), kB in o, Object.getOwnPropertySymbols(o).length);
o[kB] = 22; o[m.s] = 33;
console.log(o[kB], o[m.s], Object.getOwnPropertySymbols(o).length, delete o[kB], kB in o);
Object.defineProperty(o, kEmpty, { value: 4, enumerable: true });
const p5 = ["const pick = (q, key) => q[key];", "return pick(o, k);"];
const read = new Function("o", "k", p5.map((_, i) => (process.argv.length > OFFN ? "" : p5[i])).join("\n"));
console.log(read(o, kEmpty), read(o, m.s), read(o, kA), read(o, kReg));
const copy = { .../** @type {any} */ (o) };
console.log(copy[kA], copy[m.s], copy[kEmpty], Object.getOwnPropertySymbols(copy).length, copy.plain);
// 4. a runtime object carrying symbol properties crosses with them
const rt = JSON.parse('{"n":1}');
rt[kA] = "rt-a"; rt[kReg] = 5;
Object.defineProperty(rt, kB, { get() { return "got"; }, enumerable: true });
const p6 = ["const r = [o[k], o[g], Object.getOwnPropertySymbols(o).length, o.n];", "return r.join('|');"];
const inspect = new Function("o", "k", "g", p6.map((_, i) => (process.argv.length > OFFN ? "" : p6[i])).join("\n"));
console.log(inspect(rt, kA, kReg));
const p7 = ["const s3 = Object.getOwnPropertySymbols(o)[2];", "return [typeof Object.getOwnPropertyDescriptor(o, s3).get, o[s3]].join('|');"];
const gets = new Function("o", p7.map((_, i) => (process.argv.length > OFFN ? "" : p7[i])).join("\n"));
console.log(gets(rt));
// 5. a class member keyed by a runtime symbol is not found through an engine symbol of the same description
const kMinted = Symbol("minted");
class Box { get [kMinted]() { return "own"; } }
const bx = new Box();
const readAny = (target, key) => target[key];
console.log(readAny(bx, kMinted), readAny(bx, m.s), readAny(bx, m.u), readAny(bx, kA));
