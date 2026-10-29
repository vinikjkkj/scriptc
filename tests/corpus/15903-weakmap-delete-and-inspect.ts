// delete() and inspect on a WeakMap, against Node.
//
// delete answers whether the key was present, removes it, and leaves the
// table otherwise untouched. A key that was never stored answers false. An
// object that was deleted stays a valid key: set() may store it again.
//
// console.log of a WeakMap prints `WeakMap { <items unknown> }` in Node,
// because a weak collection cannot be enumerated. The inspect path must
// print exactly that, both at the top level and inside a composite.

class Tag {
  readonly label: string;
  constructor(label: string) {
    this.label = label;
  }
}

const seen = new WeakMap<Tag, string>();
const a = new Tag("a");
const b = new Tag("b");
const c = new Tag("c");

seen.set(a, "one");
seen.set(b, "two");

console.log("delete present:", seen.delete(a));
console.log("delete again:", seen.delete(a));
console.log("delete absent:", seen.delete(c));
console.log("has a:", seen.has(a), "get a:", seen.get(a));
console.log("has b:", seen.has(b), "get b:", seen.get(b));

seen.set(a, "three");
console.log("re-added a:", seen.has(a), seen.get(a));

console.log(seen);
const holder = { table: seen };
console.log(holder.table);
