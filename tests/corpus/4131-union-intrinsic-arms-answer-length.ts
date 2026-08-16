// `.length` over a union whose arms are INTRINSIC — `Uint8Array | string |
// readonly T[]`. `Array.isArray(n.content)` cannot narrow the `readonly T[]`
// arm (the predicate is `arg is any[]`), so the checker answers `any[]`, every
// element read below it is `any`, and `inner.content.length` arrives at the
// last-resort property fence with checker type `any` while the VALUE still
// carries the real union.
//
// The three union-receiver strategies that existed all walk `def.arms`
// looking for a DECLARED field, and a bytes/string/array arm declares none —
// so the read declined and fenced as
//   SC1090 reading 'length' from a value of type 'any'
// even though all three arms answer `.length` in JavaScript. They answer it in
// the IR too, as an intrinsic of each arm's own representation, so the read is
// a tag switch over bytesIntrinsic / strIntrinsic / arrIntrinsic.
//
// The negative half, which is why this is a proof and not a forcing: change
// any arm to a kind that cannot answer `.length` (a number arm) and the read
// is still refused — it reaches the same code path and declines there.
interface WireNode {
  readonly tag: string;
  readonly content?: Uint8Array | string | readonly WireNode[];
}

function lengthOfChild(n: WireNode, want: string): number {
  if (!Array.isArray(n.content)) return -1;
  for (const inner of n.content) {
    if (inner.tag !== want) continue;
    return inner.content.length;
  }
  return -2;
}

const root: WireNode = {
  tag: "message",
  content: [
    { tag: "arr", content: [{ tag: "a" }, { tag: "b" }, { tag: "c" }] },
    { tag: "str", content: "hello" },
    { tag: "utf", content: "héllo日" },
    { tag: "buf", content: new Uint8Array([1, 2, 3, 4]) },
    { tag: "empty", content: [] },
  ],
};

console.log(lengthOfChild(root, "arr"));
console.log(lengthOfChild(root, "str"));
console.log(lengthOfChild(root, "utf"));
console.log(lengthOfChild(root, "buf"));
console.log(lengthOfChild(root, "empty"));
console.log(lengthOfChild(root, "absent"));
console.log(lengthOfChild({ tag: "leaf", content: "x" }, "arr"));
