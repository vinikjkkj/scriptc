// The any-typed spelling of the chain test: A > B > D, and a sibling F extends A.
// An instance of D is instanceof A, B and D; an F is instanceof A only; a plain
// object with the same fields is none of them; primitives answer false.
class A {
  kind = "A";
}
class B extends A {
  kind = "B";
}
class D extends B {
  kind = "D";
}
class F extends A {
  kind = "F";
}
const values: any[] = [new A(), new B(), new D(), new F(), null, undefined, 7, "A"];
for (let i = 0; i < values.length; i++) {
  const v = values[i];
  console.log(i, v instanceof A, v instanceof B, v instanceof D, v instanceof F);
}
const plain: any = { kind: "D" };
console.log("plain", plain instanceof A, plain instanceof D);
const leaf: any = new D();
console.log(leaf instanceof A && leaf instanceof B && leaf instanceof D && !(leaf instanceof F));
