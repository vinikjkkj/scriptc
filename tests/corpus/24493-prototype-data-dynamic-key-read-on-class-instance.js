// A dynamic-key read of a name the class carries as prototype data answers the datum while the instance has no own field of that
// name (the lookup reaches the prototype), the own value once it has one, and the datum of the NEAREST class on the chain.
class A { constructor() { this.a = 1; } }
A.prototype.call = "a-proto";
A.prototype.label = "lbl";
class Sub extends A { constructor() { super(); this.s = 2; } }
class Over extends A {}
Over.prototype.label = "over-lbl";
const a = new A(), s = new Sub(), set = new A(), o = new Over();
set.call = "own";
const rows = [a, s, set, o, { call: 1 }, {}];
function f(e, k) { return e[k]; }
function g(e) { const { call, label } = e; return [call, label].join("/"); }
for (const e of rows) console.log(f(e, "call"), f(e, "label"), f(e, "a"), f(e, "s"), f(e, "nope"), g(e));
