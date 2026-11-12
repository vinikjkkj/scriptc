// A plain function used as a constructor mints its implicit prototype lazily (the second lazy member of the closure ext block). The
// minted prototype is a traced edge, the constructor registry is keyed by it, and both teardown paths must erase the entry and free the
// block, including when props and the prototype share one closure.
"use strict";
function Animal(name) { this.name = name; }
Animal.prototype.speak = function () { return this.name + " makes a sound"; };
Animal.prototype.kind = "animal";
const a1 = new Animal("rex");
const a2 = new Animal("tom");
console.log(a1.speak(), a2.speak(), a1.kind, Object.getPrototypeOf(a1) === Animal.prototype, a1.constructor === Animal);
console.log(Object.keys(Animal.prototype).join(","), a1 instanceof Animal, a1.hasOwnProperty("kind"));

// per-iteration constructors: each closure mints its own prototype and drops it with itself
function build(i) {
  function F(v) { this.v = v + i; }
  F.prototype.get = function () { return this.v; };
  F.prototype.constructor = F; // the ring N.prototype.constructor = N
  const o = new F(i);
  let t = o.get();
  if (i % 7 === 0) { F.extra = i; t += F.extra; } // a props table and a prototype on the same closure
  return t;
}
let total = 0;
for (let i = 0; i < 400; i++) total += build(i);
console.log("total", total);
