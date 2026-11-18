// An absent-until-written field that holds an object pointing back at its instance lives in the overflow array: the cycle through it must still be seen and collected, and
// the many instances that never write the field must not leak or double free.
class Node2 {
  constructor(a, b, c, d) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
  }
  sum() { return this.a + this.b + this.c + this.d; }
  attach(v) { this.peer = v; }
  tag(t) { this.label = t; }
}
Node2.prototype.peer = undefined;
Node2.prototype.label = "none";
let total = 0;
for (let round = 0; round < 40; round++) {
  const batch = [];
  for (let i = 0; i < 500; i++) {
    const n = new Node2(i, round, 1, 2);
    if (i % 3 === 0) n.attach({ owner: n, tag: i });
    if (i % 5 === 0) n.tag("t" + i);
    batch.push(n);
  }
  for (const n of batch) total += n.sum() + (n.peer === undefined ? 0 : n.peer.tag) + n.label.length;
}
console.log(total);
const solo = new Node2(1, 2, 3, 4);
solo.attach({ owner: solo, tag: 99 });
console.log(solo.peer.owner === solo, solo.peer.tag, solo.label, Object.keys(solo).join(","));
