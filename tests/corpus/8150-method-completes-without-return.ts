// A method whose only `return` sits behind a condition completes with
// undefined on the other path -- instance and static, plain and with a value
// of a union type -- exactly like a function declaration does.
class Counter {
  n = 0;
  first(limit: number) {
    if (this.n >= limit) return this.n;
    this.n += 1;
  }
  label(flag: boolean) {
    if (flag) return "yes";
    this.n += 10;
  }
  static pick(x: number) {
    if (x > 0) return x * 2;
  }
}

const c = new Counter();
console.log(c.first(1), c.first(1), c.n);
console.log(c.label(true), c.label(false), c.n);
console.log(Counter.pick(4), Counter.pick(-4));
