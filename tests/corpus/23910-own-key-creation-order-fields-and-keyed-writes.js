"use strict";
// Own keys list in CREATION order: a field enters the order when it is first assigned, a key written under a run-time key when it is
// first written; integer-like keys come first ascending. Constructor writes, writes before and after later field assignments, a
// subclass, a field first assigned in a method, and two instances created in different orders. Every enumerating surface sees it.
class Box {
  constructor(a, early) {
    this.a = a;
    if (early) this.put("early", 0);
    this.put("k1", 1);
    this.b = 2;
    this.put("7", "seven");
    this.put("k2", [1, 2]);
    this.c = 3;
  }
  put(k, v) {
    this[k] = v;
  }
  later() {
    this.late = "L";
    this.put("k3", 3);
    this.d = 4;
  }
}
class Sub extends Box {
  constructor() {
    super(9, true);
    this.put("s0", 0);
    this.own = "sub";
  }
}
function dump(label, o) {
  console.log("--", label);
  console.log(Object.keys(o).join());
  console.log(JSON.stringify(o));
  console.log(o);
  const seen = [];
  for (const k in o) seen.push(k);
  console.log(seen.join());
  console.log(Object.values(o).length, JSON.stringify(Object.entries(o)), JSON.stringify({ ...o }), JSON.stringify(Object.assign({}, o)));
  console.log(Object.getOwnPropertyNames(o).join());
}
const b = new Box(1, false);
dump("fresh", b);
b.later();
b.put("0", "zero");
dump("after later", b);
dump("early", new Box(2, true));
const s = new Sub();
dump("sub", s);
s.later();
dump("sub later", s);
