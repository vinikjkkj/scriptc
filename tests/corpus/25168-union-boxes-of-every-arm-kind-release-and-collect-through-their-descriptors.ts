// A union box keeps its payload's release entry point and trace flag in a shared per-type descriptor (not in the box). Every arm kind goes
// through that descriptor here: scalar arms (none), a string, a number array, a record, a class instance that closes a cycle (traced), a
// class instance that cannot (untraced), and the immortal unit arms, built and dropped in volume so a wrong release or a missed trace
// shows up as a crash, a leak under the sanitize lane, or a wrong total.
class Cell { readonly k = "cell"; other: Cell | null = null; tag: string; constructor(tag: string) { this.tag = tag; } }
class Leaf { readonly k = "leaf"; n: number; constructor(n: number) { this.n = n; } }
interface Rec { k: "rec"; a: number; b: string }
type U = string | number | boolean | number[] | Rec | Cell | Leaf | null;

function make(i: number): U {
  switch (i % 8) {
    case 0: return "s" + (i % 13);
    case 1: return i * 0.5;
    case 2: return i % 2 === 0;
    case 3: return [i, i + 1, i + 2];
    case 4: return { k: "rec", a: i, b: "r" + i };
    case 5: { const c = new Cell("c" + i); c.other = c; return c; } // a cycle through the traced arm
    case 6: return new Leaf(i);
    default: return null;
  }
}
function weigh(u: U): number {
  if (u === null) return 1;
  if (typeof u === "string") return u.length;
  if (typeof u === "number") return u;
  if (typeof u === "boolean") return u ? 2 : 3;
  if (Array.isArray(u)) return u[0]! + u[2]!;
  if (u.k === "cell") return u.tag.length + (u.other === u ? 100 : 0);
  if (u.k === "leaf") return u.n;
  return u.a + u.b.length;
}
function churn(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const u = make(i);
    const copy: U = u;
    total += weigh(copy);
  }
  return total;
}
console.log(churn(40000));

// live unions of every kind held at once, then dropped
const live: U[] = [];
for (let i = 0; i < 4000; i++) live.push(make(i));
let sum = 0;
for (const u of live) sum += weigh(u);
console.log(sum, live.length);
live.length = 0;
console.log(churn(2000), weigh(null));

// a union field in a record and in a class, reassigned across arms
class Holder { v: U = null; }
const holders: Holder[] = [];
for (let i = 0; i < 500; i++) { const h = new Holder(); h.v = make(i); h.v = make(i + 3); holders.push(h); }
let hs = 0;
for (const h of holders) hs += weigh(h.v);
console.log(hs);
