"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scenario = scenario;
// A class whose instances take own properties under run-time keys: reading a method as a value answers the own property when
// one shadows it, whatever its type, and the method otherwise.
class Box {
  put(k, v) {
    this[k] = v;
  }
  hello() {
    return "hello";
  }
  total(a, b) {
    return a + b;
  }
  other(a, b) {
    return a - b;
  }
  callHello() {
    return this.hello();
  }
  pick(flag) {
    return (flag ? this.total : this.other).bind(this);
  }
}
function attempt(fn) {
  try {
    const r = fn();
    return typeof r === "function" ? "fn" : String(r);
  } catch (e) {
    return e.name + ": " + e.message;
  }
}
function scenario(log) {
  const b = new Box();
  const plain = b.hello;
  log(typeof plain + " " + plain.call(b));
  log(b.total.bind(b)(2, 3) + " " + b.pick(true)(7, 2) + " " + b.pick(false)(7, 2));
  b.put("hello", 5);
  const shadowed = b.hello;
  log(typeof shadowed + " " + shadowed);
  log(attempt(() => b.hello.bind(b)));
  log(attempt(() => b.hello()) + " | " + attempt(() => b.callHello()));
  b.put("total", (x, y) => x * y);
  const swapped = b.total;
  log(typeof swapped + " " + swapped(3, 4) + " " + b.pick(true)(3, 4) + " " + attempt(() => swapped.call(null, 2, 5)));
  const other = new Box();
  log(typeof other.hello + " " + other.total(1, 2));
}
