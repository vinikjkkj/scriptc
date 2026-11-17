// A class with six numeric fields written in its constructor keeps them in 32-bit lanes (a presence mask says which lanes hold a value): every integer
// 0..4294967295 reads back exactly, in the typed read, through the dyn member path, and in JSON.stringify / Object.keys / Object.values.
class Rec {
  a: any;
  b: any;
  c: any;
  d: any;
  e: any;
  f: any;
  constructor(s: any) {
    this.a = s.a;
    this.b = s.b;
    this.c = s.c;
    this.d = s.d;
    this.e = s.e;
    this.f = s.f;
  }
  total(): any {
    return this.a + this.b + this.c + this.d + this.e + this.f;
  }
}

const srcs: any[] = [
  { a: 0, b: 1, c: 1023, d: 1024, e: 65534, f: 65535 },
  { a: 65536, b: 16777215, c: 16777216, d: 2147483647, e: 2147483648, f: 4294967294 },
  { a: 4294967295, b: 4294967295, c: 0, d: 4294967295, e: 1, f: 4294967295 },
  { a: 4294967294, b: 4294967293, c: 4294967292, d: 4294967291, e: 4294967290, f: 4294967289 },
];
const recs: Rec[] = srcs.map((s) => new Rec(s));

function asAny(o: any): any {
  return o;
}

for (const r of recs) {
  const o = asAny(r);
  console.log("typed", r.a, r.b, r.c, r.d, r.e, r.f, r.total());
  console.log("keys", Object.keys(o).join(","));
  const vals: any[] = Object.values(o);
  console.log("values", vals.join("|"));
  console.log("json", JSON.stringify(o));
  console.log("dyn", o.a, o["b"], o.c, o["d"], o.e, o["f"]);
}
