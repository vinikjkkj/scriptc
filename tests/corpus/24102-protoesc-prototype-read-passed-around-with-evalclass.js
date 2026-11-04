"use strict";
// A function's prototype object is read, copied into locals, passed to helpers and enumerated, with an evaluated class in the program.
function Ctor(v) { this.v = v; }
const p = Ctor.prototype;
p.get = function () { return this.v; };
p.twice = function () { return this.v * 2; };
function extend(proto, more) { for (const k of Object.keys(more)) proto[k] = more[k]; return proto; }
extend(Ctor.prototype, { thrice() { return this.v * 3; }, label: "ctor" });
function mkC(n) { return class { m() { return n; } }; }
const box = { c: mkC(5), f: Ctor };
const K = box.c;
const c = new Ctor(4);
console.log(c.get(), c.twice(), c.thrice(), c.label, Object.keys(p).join(","));
console.log(p === Ctor.prototype, p.constructor === Ctor, new K().m());
