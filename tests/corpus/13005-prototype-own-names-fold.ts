// Object.getOwnPropertyNames(K.prototype) for a program class K: Node's
// own-name list (constructor first, then methods and accessors in
// declaration order, static members excluded, inherited names excluded).
class Base {
  inherited(): number {
    return 0;
  }
}
class A extends Base {
  m(): number {
    return 1;
  }
  get g(): number {
    return 2;
  }
  set g(v: number) {}
  static s(): number {
    return 3;
  }
}
console.log(Object.getOwnPropertyNames(A.prototype).join(","));
console.log(Object.getOwnPropertyNames(A.prototype).length, Object.getOwnPropertyNames(Base.prototype).join(","));
const a = new A();
console.log(a.m(), A.s());
