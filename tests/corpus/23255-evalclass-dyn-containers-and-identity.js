// Evaluated class values stored in an array, a Map (as keys and values), an object and a typed expando,
// read back from them, constructed through them, and compared: two evaluations of one class expression
// are two classes, two reads of one evaluation are one class.
class Base { constructor(a) { this.a = a; } who() { return "base" + this.a; } }
function mk(tag, n = 0) {
  return class Made extends Base {
    constructor(a) { super(a + n); this.tag = tag; }
    static n = n;
  };
}
const holder = {};
holder.A = mk("A", 1);
holder.B = mk("B", 2);
const A = holder.A, B = holder.B;
const arr = [A, B];
console.log(arr[0] === A, arr[1] === B, arr[0] === arr[1], new arr[1](1).a);
console.log(new arr[0](1).tag, new arr[1](1).tag, new A(0) instanceof A, new A(0) instanceof B);
const m = new Map();
m.set(A, "first");
m.set(B, "second");
console.log(m.get(A), m.get(B), m.get(holder.A), m.size, m.has(mk("A", 1)));
const byName = { a: A, b: B };
console.log(byName.a === A, byName.b.n, Object.keys(byName));
function anyv(x) { return x; }
const set = new Set([anyv(A), anyv(A), anyv(B)]);
console.log(set.size);
