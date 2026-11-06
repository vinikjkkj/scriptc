// hasOwnProperty answers false for a name the instance only inherits from its prototype (unset field), true once the instance holds it.
class A { constructor() { this.a = 1; } }
A.prototype.call = "a-proto";
A.prototype.label = "lbl";
class Sub extends A { constructor() { super(); this.s = 2; } }
const a = new A(), s = new Sub(), set = new A();
set.call = "own";
const rows = [a, s, set, { call: 1 }, {}];
function viaObject(e, k) { return Object.hasOwnProperty.call(e, k); }
function viaMethod(e, k) { return e.hasOwnProperty(k); }
function has(e, k) { return k in e; }
for (const e of rows) {
  console.log(viaObject(e, "call"), viaObject(e, "label"), viaObject(e, "a"), viaObject(e, "s"), viaObject(e, "nope"),
    viaMethod(e, "call"), viaMethod(e, "label"), viaMethod(e, "a"), has(e, "call"), has(e, "label"), has(e, "nope"));
}
