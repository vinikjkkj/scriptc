/* `this` in a static method is the RECEIVER. It is compiled as the declaring class only when no other receiver can reach the member:
 * a subclass inherits the static and calls it with itself as `this`; a detached or rebound use (`const f = C.m`, `C.m.call(x)`)
 * gives it another `this` or none. Each of these keeps the SC1090 refusal. */
class Base {
  static count = 0;
  static bump(): number {
    this.count += 1;
    return this.count;
  }
}
class Derived extends Base {}
console.log(Base.bump(), Derived.bump());

class Loose {
  static n = 1;
  static read(): number {
    return this.n;
  }
}
const detached = Loose.read;
console.log(typeof detached);

class Rebound {
  static n = 1;
  static read(): number {
    return this.n;
  }
}
console.log(Rebound.read.call({ n: 5 }));
