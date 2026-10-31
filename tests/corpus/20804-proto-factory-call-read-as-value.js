// The installed method read as a value keeps its identity and is callable through apply and call.
"use strict";
class Wire {
  constructor() { this.n = 1; }
}
function gen(name) {
  return function (x) { return name + ":" + this.n + ":" + x; };
}
Wire.prototype.call = gen("call");
const w = new Wire();
console.log(w.call.call({ n: 5 }, 1), w.call.apply({ n: 6 }, [2]));
const f = w.call;
console.log(typeof f, typeof Wire.prototype.call, f.call({ n: 9 }, 3));
