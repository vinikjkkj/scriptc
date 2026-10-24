// `x[k](args)` is a method call: `this` is x. With a class method read off an
// untyped instance being the class's own (unbound) function, the receiver has to
// ride the call, or `x[k]()` threw "Cannot read properties of undefined".
class Counter {
  constructor(n) { this.n = n; }
  get() { return this.n; }
  add(k) { this.n += k; return this; }
}
function call0(x, k) { return x[k](); }
function call1(x, k, a) { return x[k](a); }
console.log(call0(new Counter(5), 'get'), call1(new Counter(5), 'add', 2).get());
const plain = { n: 7, get() { return this.n; } };
console.log(call0(plain, 'get'));
const names = ['get', 'add'];
console.log(call0(call1(new Counter(1), names[1], 10), names[0]));
