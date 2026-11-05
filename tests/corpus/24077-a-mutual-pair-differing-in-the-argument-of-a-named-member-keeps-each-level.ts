// A mutually recursive pair whose levels differ in the ARGUMENT of the member they name: A<T>.next is B<T[]>[], and B<T> extends a base
// holding `v: T`. Level k has v: number[]..., so reading or writing `v` at the wrong level's layout would read the wrong field type.
type More<T> = T extends number[][][][][][] ? undefined : A<T>;
interface Base<T> { v: T }
interface B<T> extends Base<T> { tag: string; up?: More<T> | undefined }
interface A<T> { name: string; next: B<T[]>[] }
const root: A<number> = {
  name: "a0",
  next: [{ v: [1, 2], tag: "b0", up: {
    name: "a1",
    next: [{ v: [[3], [4, 5]], tag: "b1", up: {
      name: "a2",
      next: [{ v: [[[6]]], tag: "b2", up: undefined }],
    } }],
  } }],
};
const b0 = root.next[0]!;
console.log(b0.v.length, b0.v[1], b0.tag);
const a1 = b0.up!;
const b1 = a1.next[0]!;
console.log(b1.v.length, b1.v[1]![1], a1.name);
const a2 = b1.up!;
const b2 = a2.next[0]!;
console.log(b2.v[0]![0]![0], b2.up === undefined);
b0.v[0] = 100;
b1.v[1]![0] = 200;
b2.v[0]![0]![0] = 300;
console.log(b0.v.join(), b1.v.map((x) => x.join("+")).join("|"), b2.v[0]![0]![0], JSON.stringify(root).length);
