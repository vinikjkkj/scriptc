const EE = require("events");
class Bus extends EE { constructor() { super(); this.hits = 0; } hit() { this.hits++; this.emit("hit", this.hits); } }
class Sub extends Bus {}
const K = Bus;
const b = new K();
b.on("hit", (n) => console.log("hit", n));
b.hit(); b.hit();
console.log(b instanceof K, b instanceof EE, b instanceof Sub, K.name);
const S = Sub;
const s = new S();
console.log(s instanceof S, s instanceof Bus, s instanceof Sub, S.name, s.hits);
function build(C) { return new C(); }
const c = build(Bus);
c.hit();
console.log(c.hits);
