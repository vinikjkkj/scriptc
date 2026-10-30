// A toString FIELD declared on a base class is inherited by the derived
// class, and a derived field of the same name overrides it. Node: the derived
// instance answers "D" for every conversion, the plain derived instance
// answers the base field's "B", and the method form of a direct call agrees.
class B {
  toString = () => "B";
}

class D extends B {
  toString = () => "D";
}

class E extends B {}

const a: any = new D();
const b: any = new E();
console.log("D", String(a), `${a}`, a.toString());
console.log("E", String(b), `${b}`, b.toString());
