// A class declared inside a function that READS the function's locals: each
// call mints a class over that call's bindings. Captured parameters, consts,
// a never-reassigned let, a captured string/boolean/array/record, reads from
// the constructor, field initializers, methods, arrows inside methods and
// getters; two calls with different values keep their own; the class is only
// constructed. Node is the oracle.
function makeCounter(label, step, flags) {
  const prefix = label + ":";
  let total = 0;
  const bump = step * 2;
  class Counter {
    seen = prefix + "new";
    constructor(start) {
      this.n = start + step;
      this.tag = label.toUpperCase();
    }
    next() {
      this.n += bump;
      return prefix + this.n;
    }
    get verbose() {
      return flags.verbose ? `${label}/${step}/${flags.depth}` : "quiet";
    }
    later() {
      return [1, 2, 3].map((k) => k * step + label.length);
    }
    describe() {
      return `${this.tag} ${this.seen} ${this.next()} ${this.verbose}`;
    }
  }
  total += step;
  const a = new Counter(10);
  const b = new Counter(20);
  return [a.describe(), b.next(), a.later().join(","), total];
}
console.log(makeCounter("x", 1, { verbose: true, depth: 3 }));
console.log(makeCounter("longer", 5, { verbose: false, depth: 0 }));

{
  const base = 100;
  const names = ["a", "b"];
  class Local {
    constructor(i) { this.i = i; }
    show() { return names[this.i] + String(base) + this.i; }
  }
  console.log(new Local(0).show(), new Local(1).show());
}

function nested(x) {
  class Outer {
    constructor() { this.v = x * 2; }
    get() { return this.v + x; }
  }
  class Inner {
    constructor(o) { this.o = o; }
    sum() { return this.o.get() + x; }
  }
  return new Inner(new Outer()).sum();
}
console.log(nested(7), nested(1));
