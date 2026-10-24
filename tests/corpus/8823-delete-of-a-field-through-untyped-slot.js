// `delete x.f` on a class instance that reached an untyped slot. A class has a
// fixed layout, so the field cannot disappear; what a program observes after
// the delete is `undefined`, a write works again, and the delete itself
// answers true. It was a loud "'delete' of the field 's' on a dynamic P is not
// supported yet". (Whether the key then still lists in Object.keys / `in` is
// the one thing the layout cannot say, and is not printed here.)
'use strict';

class P {
  constructor() { this.n = 1; this.s = "a"; this.flag = true; this.opt = undefined; }
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
write(p, "n", 42);
console.log(read(p, "n"), p.n + 1);
write(p, "s", "again");
console.log(read(p, "s"));
console.log(del(p, "opt"), read(p, "opt"));
console.log(del(p, "nosuchkey"), read(p, "nosuchkey"));
console.log(del(p, "m"), typeof read(p, "m"), p.m());
// the same instance, read statically
console.log(p.n, p.s, p.flag);
