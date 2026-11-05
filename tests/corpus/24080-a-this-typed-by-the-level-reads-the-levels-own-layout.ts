// A function member typed `this: { t: T }` where T differs by level, whose body READS this.t: the level's own layout is what is read.
type Wrap<T> = { w: T };
type Nx<T> = T extends { w: { w: { w: { w: { w: { w: unknown } } } } } } ? undefined : N<Wrap<T>>;
interface N<T> {
  t: T;
  label: string;
  g: (this: { t: T }, k: number) => string;
  next?: Nx<T> | undefined;
}
const n2: N<Wrap<Wrap<{}>>> = { t: { w: { w: {} } }, label: "two", g(k) { return "g2:" + typeof this.t.w + ":" + typeof this.t.w.w + ":" + k; } };
const n1: N<Wrap<{}>> = { t: { w: {} }, label: "one", g(k) { return "g1:" + typeof this.t.w + ":" + k; }, next: undefined };
const n0: N<{}> = { t: {}, label: "zero", g(k) { return "g0:" + typeof this.t + ":" + k; }, next: n1 };
console.log(n0.g(0), n1.g(1), n2.g(2));
console.log(n0.next!.g(5), n0.next!.label, (n0.next!.t as { w: unknown }).w !== undefined);
n1.t = { w: { z: 1 } as unknown as {} };
console.log(n0.next!.g(6), JSON.stringify(n1.t));
