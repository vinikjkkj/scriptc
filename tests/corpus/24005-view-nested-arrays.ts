// Nested views and arrays of views: a member read off a view that is itself a record is a view of the
// member object, and an array of records holds views of its element objects.
interface Leaf { v: number }
interface Mid { leaf: Leaf; leaves: Leaf[] }
interface Top { mid: Mid; name: string }
const raw = JSON.parse('{"mid":{"leaf":{"v":1},"leaves":[{"v":2},{"v":3,"k":1}]},"name":"t","extra":0}') as unknown;
const top = raw as Top;
top.mid.leaf.v = 10;
top.mid.leaves[1]!.v = 30;
console.log(JSON.stringify(raw));
const l = top.mid.leaf;
l.v = 11;
console.log(top.mid.leaf.v, l === top.mid.leaf, top.mid.leaves.length);
(raw as { mid: { leaves: { v: number }[] } }).mid.leaves[0]!.v = 20;
console.log(top.mid.leaves[0]!.v, top.mid.leaves.map((x) => x.v));
console.log(top);
const list = JSON.parse('[{"v":1,"q":1},{"v":2}]') as Leaf[];
for (const e of list) e.v *= 2;
console.log(list, JSON.stringify(list));
