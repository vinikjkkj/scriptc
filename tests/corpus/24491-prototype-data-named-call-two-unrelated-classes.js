// Two unrelated classes carry prototype data under the same name; an untyped read picks the answer by the receiver's class.
class A { constructor() { this.a = 1; } }
A.prototype.call = "a-proto";
class B { constructor() { this.b = 2; } }
B.prototype.call = "b-proto";
function read(e) { return e.call; }
console.log(read(new A()), read(new B()), read({ call: "own" }), read({}));
const a = new A();
a.call = "a-own";
console.log(read(a), read(new A()));
// A class and its subclass both carry the name: the nearest class on the instance's chain answers.
class Base { constructor() { this.tag = "b"; } }
Base.prototype.label = "base-label";
class Derived extends Base {}
Derived.prototype.label = "derived-label";
function show(x) { return x.label; }
console.log(show(new Derived()), show(new Base()));
