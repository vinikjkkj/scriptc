// Rewrites through the dyn key move a field between its lane and the overflow array in every direction (lane -> overflow -> lane -> other kind ->
// undefined -> lane, -0, 2^32 ...); every neighbour must keep its value at every step, typed and through the dyn path.
class Rec {
  a: any;
  b: any;
  c: any;
  d: any;
  e: any;
  constructor(s: any) {
    this.a = s.a;
    this.b = s.b;
    this.c = s.c;
    this.d = s.d;
    this.e = s.e;
  }
  total(): any {
    return this.a + this.b + this.c + this.d + this.e;
  }
}
function asAny(o: any): any {
  return o;
}
function show(v: any): string {
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : "n" + v;
  return typeof v + ":" + String(v);
}
function dump(tag: string, r: Rec): void {
  const o = asAny(r);
  console.log(tag, [show(r.a), show(r.b), show(r.c), show(r.d), show(r.e)].join(" "), "|", [show(o.a), show(o.b), show(o.c), show(o.d), show(o.e)].join(" "));
}
const r = new Rec({ a: 1, b: 4294967295, c: 3, d: 65536, e: 5 });
const o = asAny(r);
dump("start", r);
o.b = "str";
dump("b=str", r);
o.b = 4294967295;
dump("b=max", r);
o.a = 4294967296;
dump("a=2^32", r);
o.c = -0;
dump("c=-0", r);
o.a = 7;
dump("a=7", r);
o.d = undefined;
dump("d=undef", r);
o.e = 1.5;
dump("e=1.5", r);
o.d = 4294967294;
dump("d=lane", r);
o.e = 0;
dump("e=0", r);
o.c = null;
dump("c=null", r);
o.c = 12;
o.b = NaN;
dump("c=12 b=NaN", r);
o.b = 99;
o.a = "again";
dump("b=99 a=again", r);
for (let i = 0; i < 6; i++) {
  o.a = i % 2 === 0 ? "s" + i : i * 1000;
  o.e = i % 3 === 0 ? -i : i;
}
dump("loop", r);
