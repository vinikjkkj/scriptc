// Each evaluation has its own statics: fields, initializers that read the
// class and the captured arguments, static methods that use `this`, and
// writes through the class value.
function make(tag: string, step: number) {
  return class Counter {
    static made = 0;
    static label = tag + "!";
    static both = Counter.label + "/" + step;
    id: number;
    constructor() {
      Counter.made += step;
      this.id = Counter.made;
    }
    static describe(): string {
      return tag + ":" + this.made + ":" + Counter.label;
    }
    static bump(by: number): number {
      Counter.made += by;
      return this.made;
    }
    who(): string {
      return Counter.describe() + "/" + this.id;
    }
  };
}
const A = make("a", 1);
const B = make("b", 10);
new A();
new A();
new B();
const a3 = new A();
console.log(A.made, B.made, A.label, B.label, A.both, B.both);
console.log(A.describe(), B.describe(), a3.who());
console.log(A.bump(5), B.bump(7), A.made, B.made);
A.made = 100;
B.made -= 3;
console.log(A.made, B.made, new A().id, new B().id);
console.log(A, B);
console.log(A.name, B.name, a3 instanceof A, a3 instanceof B);
