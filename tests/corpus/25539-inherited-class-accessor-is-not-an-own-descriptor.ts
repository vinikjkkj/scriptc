// An accessor declared on the base is an own property of the BASE prototype only; the subclass prototype has none until it declares one.
class B { get v() { return 1; } }
class D extends B { get w() { return 2; } }
const own: any = Object.getOwnPropertyDescriptor(D.prototype, "v");
const base: any = Object.getOwnPropertyDescriptor(B.prototype, "v");
const dw: any = Object.getOwnPropertyDescriptor(D.prototype, "w");
console.log(own === undefined, base.get.name, dw.get.name);
console.log(Object.getOwnPropertyNames(D.prototype).join(","), Object.getOwnPropertyNames(B.prototype).join(","));
console.log(base.get.call(new D()), dw.get.call(new D()));
