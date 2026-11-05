// A function member whose parameter type depends on the level, and one that uses `this` (typed by the level).
type Wrap<T> = { w: T };
type Next<T> = T extends { w: { w: { w: { w: { w: { w: unknown } } } } } } ? undefined : N<Wrap<T>>;
interface N<T> {
  label: string;
  f: (x: T) => string;
  g: (this: N<T>, k: number) => string;
  next?: Next<T> | undefined;
}
function mk0(): N<{}> {
  return { label: "L0", f: (x) => "f0:" + typeof x, g(k) { return this.label + ":" + k; }, next: undefined };
}
const n0 = mk0();
console.log(n0.f({}), n0.g(1));
const n1: N<Wrap<{}>> = { label: "L1", f: (x) => "f1:" + typeof x.w, g(k) { return this.label + "/" + k * 2; } };
console.log(n1.f({ w: {} }), n1.g(2));
n0.next = n1;
console.log(n0.next!.f({ w: {} }), n0.next!.g(3), n0.g(4));
const lab = n1.label;
n1.label = "renamed";
console.log(lab, n0.next!.label, n0.next!.g(5));
