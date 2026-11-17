// A constructor that leaks `this` before it writes every field, and one that throws half way: the unwritten fields read undefined (presence mask clear,
// no overflow array), the written ones their value, and a dropped half-built instance leaves nothing behind.
class Leak {
  seen: any;
  mid: string;
  constructor() {
    this.seen = undefined;
    this.mid = "";
  }
}
class Rec {
  a: any; b: any; c: any; d: any; e: any;
  constructor(s: any, leak: Leak) {
    leak.seen = this;
    this.a = s.a;
    this.b = s.b;
    leak.mid = String(this.a) + "," + String(this.b) + "," + String(this.c);
    if (s.boom) throw new Error("boom");
    this.c = s.c;
    this.d = s.d;
    this.e = s.e;
  }
  total(): any { return this.a + this.b + this.c + this.d + this.e; }
}
function show(v: any): string {
  return typeof v === "number" ? (Object.is(v, -0) ? "-0" : "n" + v) : typeof v + ":" + String(v);
}
const leak = new Leak();
const ok = new Rec({ a: 1, b: 2, c: 3, d: 4294967295, e: 5 }, leak);
console.log("ok", [show(ok.a), show(ok.b), show(ok.c), show(ok.d), show(ok.e)].join(" "), "mid", leak.mid);
for (let i = 0; i < 4; i++) {
  const l2 = new Leak();
  try {
    new Rec({ a: i, b: i === 2 ? "s" : 4294967296, boom: true }, l2);
  } catch (e) {
    const p: any = l2.seen;
    console.log("threw", String(e), [show(p.a), show(p.b), show(p.c), show(p.d), show(p.e)].join(" "), "mid", l2.mid);
  }
}
