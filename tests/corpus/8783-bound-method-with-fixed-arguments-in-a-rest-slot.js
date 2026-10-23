"use strict";
// `obj.method.bind(obj, a, b)` leaves a function of no remaining parameters; the
// binding it is stored in is typed by the checker with a rest slot, so the value
// has to fit a `(...args) => R` type. Called later, once or many times.
class Meter {
  constructor() {
    this.total = 0;
  }
  add(by, label) {
    this.total += by;
    return this.total;
  }
  later(by) {
    const f = this.add.bind(this, by, "later");
    return f();
  }
  twice(by) {
    const f = this.add.bind(this, by, "twice");
    return () => f() + f();
  }
  partial(by) {
    const f = this.add.bind(this, by);
    return f("tail");
  }
}
const m = new Meter();
console.log(m.later(5), m.later(2));
const t = m.twice(10);
console.log(t(), t());
console.log(m.partial(1), m.total);
