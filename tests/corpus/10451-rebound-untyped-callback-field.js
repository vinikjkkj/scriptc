// A bound function over an untyped field is itself bindable: the second bind
// keeps the first receiver (JS ignores a later thisArg) and appends its own
// leading arguments after the first bind's. Length stacks: the target's length
// minus every bound argument, floored at zero. The bound value is also passed
// through an ordinary function parameter and invoked there.

class Holder {
  constructor(fn) {
    this.handler = fn;
    this.name = "holder";
  }

  wrap(first) {
    return this.handler.bind(this, first);
  }
}

function sum(a, b, c, d) {
  console.log("sum", this.name, a, b, c, d);
  return a + b + c + d;
}

function run(f, x) {
  return f(x);
}

const h = new Holder(sum);
const once = h.wrap(1);
console.log("once.len", once.length);
const twice = once.bind(null, 2);
console.log("twice.len", twice.length);
console.log("twice", twice(3, 4));
console.log("passed", run(twice, 9));
console.log("beyond", twice(5, 6, 7));

const none = new Holder(undefined);
try {
  none.wrap(1);
} catch (e) {
  console.log("threw", e.message);
}
