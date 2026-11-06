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
