// Every surface that enumerates or copies an instance must see lane fields and overflow fields alike: Object.assign, spread, entries, JSON round trip,
// util.inspect, getOwnPropertyDescriptor, hasOwn, in.
import { inspect } from "node:util";
class Rec {
  a: any; b: any; c: any; d: any; e: any;
  constructor(s: any) { this.a = s.a; this.b = s.b; this.c = s.c; this.d = s.d; this.e = s.e; }
  total(): any { return this.a + this.b + this.c + this.d + this.e; }
}
function asAny(o: any): any {
  return o;
}
const srcs: any[] = [
  { a: 1, b: 4294967295, c: 3, d: 65536, e: 5 },
  { a: 4294967296, b: 4294967295, c: "x", d: -0, e: 1.5 },
  { a: undefined, b: null, c: NaN, d: 0, e: 4294967294 },
];
for (const s of srcs) {
  const o = asAny(new Rec(s));
  console.log("assign", JSON.stringify(Object.assign({}, o)));
  console.log("entries", JSON.stringify(Object.entries(o)));
  console.log("json", JSON.stringify(o), JSON.stringify(JSON.parse(JSON.stringify(o))));
  console.log("inspect", inspect(o));
  const d = Object.getOwnPropertyDescriptor(o, "a") as any;
  console.log("desc", d.enumerable, d.writable, d.configurable, Object.is(d.value, o.a));
  console.log("has", Object.hasOwn(o, "a"), Object.hasOwn(o, "e"), "c" in o, "zz" in o);
  console.log("names", Object.getOwnPropertyNames(o).join(","));
}
