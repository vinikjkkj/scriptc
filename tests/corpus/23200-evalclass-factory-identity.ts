// A class expression inside a function mints a distinct class per evaluation:
// fresh identity, closed over that call's arguments, told apart by instanceof.
function make(tag: string, n: number) {
  return class Box {
    v = 1;
    show(): string {
      return tag + ":" + (n + this.v);
    }
  };
}
const A = make("a", 10);
const B = make("b", 20);
const A2 = make("a", 10);
const a = new A();
const b = new B();
console.log(a.show(), b.show());
console.log(A === B, A === A, A === A2);
console.log(A.name, B.name);
console.log(a instanceof A, a instanceof B, b instanceof B, b instanceof A, new A2() instanceof A);
console.log(a.constructor === A, b.constructor === A, a.constructor.name);
const classes = [A, B, A2];
const insts = classes.map((C) => new C());
console.log(insts.map((x) => x.show()).join(" "));
console.log(classes.map((C) => insts.filter((x) => x instanceof C).length).join(","));
