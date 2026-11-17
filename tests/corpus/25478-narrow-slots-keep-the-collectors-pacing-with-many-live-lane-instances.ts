// Many live instances whose every field sits in a lane (no number node exists for any of them): the collector must pace as it does for node-held numbers
// (the pacing weight counts a lane like the node it replaces), and the answers must not change. Prints only values, never counts of passes.
class Rec {
  a: any; b: any; c: any; d: any; e: any; f: any;
  constructor(s: any) { this.a = s.a; this.b = s.b; this.c = s.c; this.d = s.d; this.e = s.e; this.f = s.f; }
  total(): any { return this.a + this.b + this.c + this.d + this.e + this.f; }
}
class Holder {
  items: Rec[];
  tag: any;
  constructor(tag: any) { this.items = []; this.tag = tag; }
}
function mk(i: number): Rec {
  return new Rec({ a: i, b: i * 3, c: 70000 + i, d: 4294967295 - i, e: i % 1024, f: i * 100000 });
}
const hold: Holder[] = [];
let sum = 0;
for (let h = 0; h < 40; h++) {
  const holder = new Holder(h);
  for (let i = 0; i < 2500; i++) holder.items.push(mk(h * 2500 + i));
  hold.push(holder);
  if (h % 5 === 4) {
    for (const x of holder.items) sum += Number(x.total()) % 1000003;
    hold[h - 2] = new Holder(-1); // drop a batch
  }
}
let live = 0;
for (const holder of hold) live += holder.items.length;
console.log("sum", sum, "live", live);
