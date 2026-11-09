// A union box whose arm is a string, a number or a boolean carries no cycle header and is never a cycle root; a union box whose arm is
// a class instance does carry one and must still be found when it closes a ring. Both kinds are copied around heavily here, and the
// rings are built and dropped in a loop so a missed collection shows up as exit-time work and as memory (see the bounded probe in the
// commit message of the change).
class Node {
  next: Node | string | number;
  label: string;
  constructor(label: string) {
    this.label = label;
    this.next = label;
  }
}
type V = string | number | boolean;
function mk(i: number): V {
  return i % 3 === 0 ? "s" + (i % 11) : i % 3 === 1 ? i : i % 2 === 0;
}
function churn(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = new Node("a" + (i % 7));
    const b = new Node("b" + (i % 5));
    a.next = b;
    b.next = a;
    const v: V = mk(i);
    const w = v;
    const x = w;
    if (typeof x === "string") total += x.length;
    else if (typeof x === "number") total += x;
    else total += x ? 1 : 0;
    const n1 = a.next;
    if (typeof n1 !== "string" && typeof n1 !== "number") total += n1.label.length;
    b.next = "end";
    total += typeof a.next === "object" ? 1 : 0;
  }
  return total;
}
console.log(churn(20000));
const ringA = new Node("ra");
const ringB = new Node("rb");
ringA.next = ringB;
ringB.next = ringA;
console.log(typeof ringA.next, (ringA.next as Node).label, ((ringA.next as Node).next as Node).label);
const mixed: V[] = [];
for (let i = 0; i < 12; i++) mixed.push(mk(i));
console.log(mixed.join(","), mixed.map((x) => typeof x).join(","));
