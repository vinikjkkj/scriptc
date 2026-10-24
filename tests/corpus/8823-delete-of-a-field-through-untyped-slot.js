// `delete x.f` on a class instance that reached an untyped slot. A class has a
// fixed layout, so the field cannot disappear; what a program observes after
// the delete is `undefined`, the key is gone from every own-key surface, and the
// delete itself answers true. It was a loud "'delete' of the field 's' on a dynamic P is not
// supported yet".
'use strict';

class P {
  constructor() { this.n = 1; this.s = "a"; this.flag = true; this.opt = undefined; this.w = 5; }
  m() { return "m"; }
}

function del(x, k) { return delete x[k]; }
function delDot(x) { return delete x.flag; }
function read(x, k) { return x[k]; }
function write(x, k, v) { x[k] = v; }

const p = new P();
console.log(del(p, "s"), read(p, "s"), typeof read(p, "s"));
console.log(delDot(p), read(p, "flag"));
console.log(del(p, "n"), read(p, "n"));
console.log(del(p, "opt"), read(p, "opt"));
console.log(del(p, "nosuchkey"), read(p, "nosuchkey"));
console.log(del(p, "m"), typeof read(p, "m"), p.m());
// the same instance, read statically
console.log(p.n, p.s, p.flag, read(p, "w"));

// what the own-key surfaces report after the delete
function afterDelete(x) {
  delete x.q;
  return JSON.stringify(Object.keys(x)) + ("q" in x) + Object.hasOwn(x, "q") + JSON.stringify(x) + Object.entries(x).length;
}
class Q { constructor() { this.q = 1; this.r = 2; } }
console.log(afterDelete(new Q()));
function twoDeletes(x) { delete x.q; delete x.r; return Object.keys(x).length + "," + x.q + "," + x.r; }
console.log(twoDeletes(new Q()));
