// A clone of a clone: each copy is an independent instance of the same class.
class Stat {
  constructor(n) {
    this.n = n;
    this.log = [];
  }
  add(x) {
    this.n = this.n + x;
    this.log.push(x);
    return this.n;
  }
  mark(k, v) {
    Object.defineProperty(this, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
}
function pass(x) {
  return x;
}
function copyOf(x) {
  return Object.create(Object.getPrototypeOf(x), Object.getOwnPropertyDescriptors(x));
}
const a = pass(new Stat(1));
a.mark("tag", "first");
const b = copyOf(a);
const c = copyOf(b);
console.log(b.add(2), c.add(3), a.add(4));
console.log(a.n, b.n, c.n, a.log.join(","), b.log.join(","), c.log.join(","));
console.log(c.tag, c instanceof Stat);
