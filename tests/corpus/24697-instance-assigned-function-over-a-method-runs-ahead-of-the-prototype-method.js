// `x.m = function` assigns an OWN property on that one object: later `x.m()` runs it with the instance as `this`, every other instance
// keeps the prototype's method, a value read of the method before the write is the prototype's function (and an override can call it
// back through the captured value), and the window closes when the own function throws.
class P {
  constructor() { this.n = 1; this.tag = "p"; }
  exec(cb) { return "base:" + this.tag + ":" + this.n + ":" + cb; }
  twice(cb) { return this.exec(cb) + "|" + this.exec(cb + cb); }
}
class S extends P {
  exec(cb) { return "S" + super.exec(cb); }
}
class Q extends P {
  constructor() { super(); this.tag = "q"; }
}
const a = new P();
const b = new P();
const s = new S();
const t = new S();
const q = new Q();
const orig = a.exec;
a.exec = function (cb) {
  if (cb === "boom") throw new Error("boom:" + this.tag);
  return "own[" + orig.call(a, cb) + "]:" + this.tag;
};
t.exec = function (cb) { return "Sown:" + cb; };
q.exec = function (cb) { return "Qown:" + this.tag + ":" + cb; };
console.log(a.exec("x"), b.exec("y"), s.exec("z"), t.exec("w"), q.exec("v"), new Q().exec("u"));
console.log(a.twice("k"), b.twice("k"), t.twice("k"), q.twice("k"));
try { a.exec("boom"); } catch (e) { console.log(e.message); }
console.log(a.exec("after"), typeof a.exec, orig.call(b, "o"));
