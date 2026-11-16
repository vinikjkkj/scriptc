// A number-slot field keeps an integer in 0..65535 in a 16-bit lane of a hidden word shared by four fields; every other value (another kind, a fraction,
// a negative, -0, NaN, 65536, 2^32, undefined, null) lives in its dyn slot. Five fields cross a word boundary, so a write to one lane must never touch a
// neighbour, and every enumerating surface must still see the declared order and the right value.
import { inspect } from "node:util";

class Cell {
  a: any;
  b: any;
  c: any;
  d: any;
  e: any;
  constructor(s: any) {
    this.a = s.p;
    this.b = s.q;
    this.c = s.r;
    this.d = s.t;
    this.e = s.u;
  }
  span(): any {
    return this.a + this.b + this.c + this.d + this.e;
  }
}

const srcs: any[] = [
  { p: 0, q: 65535, r: 65536, t: 1, u: 2 },
  { p: -1, q: 1.5, r: -0, t: 3, u: 4 },
  { p: NaN, q: "s", r: null, t: 65535, u: 0 },
  { p: 4294967296, q: 7, r: undefined, t: 65534, u: 65535 },
  { p: 65534, q: 65535.5, r: 12, t: -65535, u: 1 },
  { p: 1023, q: 1024, r: 65535, t: 0, u: 65536 },
];
const cells: Cell[] = srcs.map((s) => new Cell(s));

function asAny(o: any): any {
  return o;
}

for (const c of cells) {
  const o = asAny(c);
  const vals: any[] = Object.values(o);
  console.log("values", vals.map((v: any) => (Object.is(v, -0) ? "-0" : String(v))).join("|"));
  console.log("typed", Object.is(c.a, -0), typeof c.b, String(c.c), c.d, c.e, c.span());
  console.log("json", JSON.stringify(o), "keys", Object.keys(o).join(","));
  console.log("inspect", inspect(o));
  // a rewrite through the dyn key with another kind (and a fitting integer back) reads back everywhere
  o.d = "z";
  o.e = 65535;
  console.log("rewrite", c.d, o.d, c.e, o.e, c.a, c.b);
}
