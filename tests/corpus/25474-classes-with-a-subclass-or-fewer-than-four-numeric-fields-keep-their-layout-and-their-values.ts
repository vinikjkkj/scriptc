// Controls: a class with a subclass and a class with only three numeric fields are not narrowed; their values (the same range of kinds) must be what
// they always were.
class Base {
  a: any; b: any; c: any; d: any; e: any;
  constructor(s: any) { this.a = s.a; this.b = s.b; this.c = s.c; this.d = s.d; this.e = s.e; }
  total(): any { return this.a + this.b + this.c + this.d + this.e; }
}
class Derived extends Base {
  extra: any;
  constructor(s: any) { super(s); this.extra = s.a; }
}
class Small {
  a: any; b: any; c: any;
  constructor(s: any) { this.a = s.a; this.b = s.b; this.c = s.c; }
  total(): any { return this.a + this.b + this.c; }
}
function asAny(o: any): any {
  return o;
}
function show(v: any): string {
  return typeof v === "number" ? (Object.is(v, -0) ? "-0" : "n" + v) : typeof v + ":" + String(v);
}
const srcs: any[] = [
  { a: 1, b: 4294967295, c: 4294967296, d: -1, e: 1.5 },
  { a: "s", b: -0, c: NaN, d: undefined, e: null },
];
for (const s of srcs) {
  const b = new Base(s);
  const d = new Derived(s);
  const sm = new Small(s);
  console.log([show(b.a), show(b.b), show(b.c), show(b.d), show(b.e)].join(" "), "|", [show(d.a), show(d.b), show(d.extra)].join(" "), "|", [show(sm.a), show(sm.b), show(sm.c)].join(" "));
  console.log(JSON.stringify(asAny(b)), JSON.stringify(asAny(d)), JSON.stringify(asAny(sm)));
}
