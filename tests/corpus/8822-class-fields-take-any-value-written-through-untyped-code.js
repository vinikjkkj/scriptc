// A class field's type is INFERRED from the constructor, and untyped code can
// store any value in it: Node stores it. A number slot cannot hold a string,
// so the write threw "expected number at $, got string". A field that untyped
// code writes a value of another type is now a checked-dynamic slot (the
// layout of the fields it agrees with is pinned by dyn-field-pin.test.ts).
'use strict';

class Counter {
  constructor() {
    this.n = 1;
    this.label = "c";
    this.on = true;
    this.next = null;
    this.stable = 5;
  }
  inc() { this.n = this.n + 1; return this; }
}
class Sub extends Counter {
  constructor() { super(); this.extra = 2; }
}

function set(x, k, v) { x[k] = v; }
function bump(x) { x.n = x.n + "!"; }

const c = new Counter();
set(c, "n", "str");
console.log(c.n, typeof c.n);
set(c, "label", 42);
console.log(c.label, typeof c.label);
set(c, "on", "no");
set(c, "next", { a: 1 });
console.log(c.on, c.next.a);
bump(c);
console.log(c.n);
c.n = 7;
console.log(c.n, c.inc().n);
c.label = "typed again";
console.log(c.label);

const s = new Sub();
set(s, "n", [1, 2]);
set(s, "extra", "x");
const sn = s.n;
console.log(Array.isArray(sn), sn.length, s.extra, typeof s.inc);

// a write of the type the field already has
const k = new Counter();
set(k, "stable", 9);
console.log(k.stable + 1, k.inc().n);

// every write lands on the object the program holds
function viaTwo(a, b) { a.n = b.n; }
const a = new Counter(), b = new Counter();
b.n = "from b";
viaTwo(a, b);
console.log(a.n, b.n);
