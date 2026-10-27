// Object.getOwnPropertyDescriptor(K.prototype, "m") for a program class K:
// Node's data descriptor. value is the prototype method (callable with a
// receiver), writable/configurable true, enumerable false.
class A {
  constructor() {
    this.tag = "a";
  }
  m() {
    return "m:" + this.tag;
  }
}
const d = Object.getOwnPropertyDescriptor(A.prototype, "m");
console.log(typeof d.value, d.writable, d.enumerable, d.configurable);
console.log(d.value.call(new A()));
console.log(Object.getOwnPropertyNames(A.prototype).join(","));
