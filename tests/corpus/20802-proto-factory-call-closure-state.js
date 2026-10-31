// A factory closure keeps state across calls; every call goes to the same installed function.
"use strict";
class Counter {
  constructor() { this.label = "c"; }
}
function makeCounter(prefix) {
  let count = 0;
  return function (step) {
    count += step;
    return prefix + this.label + count;
  };
}
Counter.prototype.bump = makeCounter("n");
const c = new Counter();
console.log(c.bump(1), c.bump(2));
const d = new Counter();
d.label = "d";
console.log(d.bump(10));
