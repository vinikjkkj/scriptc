// A class that is both container-bit gated (every reference field is dynamic) and has number-slot fields (a numeric constructor write from a property read): the
// slot values read back, instances that later hold a container are collected in a cycle, a leaf-only instance reachable only from a garbage cycle is freed with
// its fields, and a million short-lived slot-holding instances leave nothing live at exit (the RC audit of the run must come out clean).
class Pos {
  start: any;
  end: any;
  label: any;
  link: any;
  constructor(src: any, i: number) {
    this.start = src.offset;
    this.end = src.offset + i;
    this.label = "p" + (i % 4);
    this.link = null;
  }
  hold(v: any): void {
    this.link = v;
  }
  span(): any {
    return this.end - this.start;
  }
}

const src: any = { offset: 70000 };
let a = 0;
for (let i = 0; i < 40000; i++) {
  const p = new Pos(src, i);
  a += p.span() + p.start;
}
console.log("leaf-only slots", a);

let b = 0;
for (let i = 0; i < 30000; i++) {
  const p = new Pos(src, i);
  if (i % 2 === 0) p.hold(p);
  else p.hold({ owner: p, n: i });
  b += p.span();
}
console.log("cyclic slots", b);

let c = 0;
for (let i = 0; i < 30000; i++) {
  const p = new Pos(src, i);
  const ring: any = { item: p, self: null };
  ring.self = ring;
  c += ring.item.span();
}
console.log("reachable only from a cycle", c);

const live: Pos[] = [];
for (let i = 0; i < 2000; i++) live.push(new Pos(src, i));
for (let r = 0; r < 20; r++) for (let i = 0; i < 5000; i++) new Pos(src, i).hold([i]);
let liveSum = 0;
for (const p of live) liveSum += p.span() + p.start;
console.log("live", live.length, liveSum, live[1999].label);
