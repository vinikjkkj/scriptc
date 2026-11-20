// A class method read as a value (not called): unbound, identity per declarer, equal to the prototype's, call/apply/bind with a receiver.
class A {
  m = new Map<string, number>([["a", 1]]);
  n = 10;
  get(k: string) { return this.m.get(k); }
  add(x: number) { return this.n + x; }
  static make() { return new A(); }
}
const a = new A();
const g = a.get;
console.log(typeof g, g.length, g.name);
console.log(g.call(a, "a"));
const add = a.add;
console.log(add.call(a, 5), add.apply(a, [6]));
try { console.log(add(1)); } catch (e: any) { console.log(e.name, e.message); }
const h = a.get.bind(a);
console.log(h("a"));
const arr = [a.add, a.get];
console.log(arr.length, typeof arr[0]);
function takes(f: (x: number) => number) { return f.call(a, 2); }
console.log(takes(a.add));
console.log(a.add === A.prototype.add, a.add === new A().add);
const mk = A.make;
console.log(typeof mk, mk().n);
