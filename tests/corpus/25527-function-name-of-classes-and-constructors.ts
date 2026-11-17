// A class's name, a subclass's, an instance's constructor, and a class expression's (the binding's, its own, or "").
class C {}
class D extends C {}
const E = class {};
const F = class Inner {};
function ctorName(o: C): string { return o.constructor.name; }
function nameOf(c: any): string { return c.name; }
console.log(C.name, D.name, E.name, F.name);
console.log(new C().constructor.name, new D().constructor.name, ctorName(new D()), ctorName(new C()));
console.log(nameOf(E), nameOf(F), nameOf(class {}) === "", nameOf(class Z {}));
const holder = { K: class {} };
console.log(holder.K.name, nameOf(holder.K));
