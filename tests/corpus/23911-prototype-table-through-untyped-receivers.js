"use strict";
// A class whose prototype table holds computed members, reached through untyped parameters: reads, calls with `this`, `in` (a literal
// and a run-time key), for-in listing the table's keys after the own ones, and a subclass instance.
class Base {
  constructor() {
    this.id = 1;
    this.put("own", 2);
  }
  put(k, v) {
    this[k] = v;
  }
}
["alpha", "beta"].forEach(function (n) {
  Base.prototype[n] = function (x) {
    return n + ":" + x + ":" + this.id;
  };
});
class Sub extends Base {
  constructor() {
    super();
    this.z = 3;
  }
}
function call(o, k) { return String(o[k](5)); }
function dot(o) { return String(o.alpha(6)) + "|" + String(o.beta(7)); }
function rd(o) { return typeof o.alpha + "," + typeof o.nope + "," + typeof o["beta"]; }
function forin(o) { const s = []; for (const k in o) s.push(k); return s.join(); }
function has(o, k) { return String("alpha" in o) + String(k in o) + String("zzz" in o) + String(Object.hasOwn(o, "alpha")); }
function js(o) { return JSON.stringify(o); }
const b = new Base();
const s = new Sub();
b.put("alpha", function (x) { return "own-alpha:" + x; });
const c = new Base();
for (const o of [b, c, s]) {
  console.log(call(o, "alpha"), call(o, "beta"), dot(o), rd(o));
  console.log(forin(o), has(o, "beta"), js(o));
}
