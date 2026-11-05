// Two instantiations that differ ONLY in the argument of the member they name must stay two shapes: levels alternate
// xs: B<string>[] and xs: B<number>[].
type Flip<U> = U extends string ? number : string;
type Stop<T> = T extends { g: { g: { g: { g: { g: { g: unknown } } } } } } ? undefined : A<T, never>;
interface B<U> { v: U }
interface A<T, U> { depth: number; xs: B<U>[]; next?: NextOf<T, U> | undefined }
type NextOf<T, U> = T extends { g: { g: { g: { g: { g: { g: unknown } } } } } } ? undefined : A<{ g: T }, Flip<U>>;
const leaf: A<{ g: { g: { g: { g: { g: { g: {} } } } } } }, string> = { depth: 6, xs: [{ v: "six" }] };
const lvl: A<{}, string> = {
  depth: 0, xs: [{ v: "zero" }],
  next: { depth: 1, xs: [{ v: 1 }], next: { depth: 2, xs: [{ v: "two" }], next: { depth: 3, xs: [{ v: 3 }] } } },
};
console.log(lvl.xs[0]!.v.length, lvl.next!.xs[0]!.v + 1, lvl.next!.next!.xs[0]!.v.toUpperCase(), lvl.next!.next!.next!.xs[0]!.v * 2);
lvl.xs[0]!.v = "ZERO";
lvl.next!.xs[0]!.v = 10;
lvl.next!.next!.xs[0]!.v = "TWO";
console.log(lvl.xs[0]!.v, lvl.next!.xs[0]!.v, lvl.next!.next!.xs[0]!.v, leaf.xs[0]!.v);
