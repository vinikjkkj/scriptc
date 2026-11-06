// for-in lists an instance's own enumerable names first, then the enumerable names it inherits from the prototype (data written by
// assignment is enumerable) -- once, and not a name the instance already lists.
class A { constructor() { this.a = 1; } }
A.prototype.call = "a-proto";
A.prototype.label = "lbl";
class Sub extends A { constructor() { super(); this.s = 2; } }
const a = new A(), s = new Sub(), set = new A();
set.call = "own";
function keys(e) { const out = []; for (const k in e) out.push(k); return out.join(); }
console.log(keys(a), "|", keys(s), "|", keys(set), "|", keys({ x: 1 }));
