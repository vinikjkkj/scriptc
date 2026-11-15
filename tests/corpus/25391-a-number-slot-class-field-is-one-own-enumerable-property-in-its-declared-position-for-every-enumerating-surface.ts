// A class field stored as a raw double while it holds a number must still be ONE own enumerable data property, in its declared position, with the
// right value, for every surface that enumerates or copies an instance: Object.keys/values/entries, JSON.stringify, util.inspect,
// Object.assign, hasOwn, getOwnPropertyDescriptor, getOwnPropertyNames.
import { inspect } from "node:util";

class Col {
  tag: string;
  start: any;
  name: string;
  len: any;
  flags: number;
  constructor(tag: string, src: any) {
    this.tag = tag;
    this.start = src.start;
    this.name = src.name;
    this.len = src.len;
    this.flags = 3;
  }
  span(): any {
    return this.start + this.len;
  }
}

const srcs: any[] = [
  { start: 4096, name: "n0", len: 70000 },
  { start: -0, name: "n1", len: 5000.25 },
  { start: NaN, name: "n2", len: "7" },
  { start: "s", name: "n3", len: null },
  { start: undefined, name: "n4", len: 1e300 },
];
const cols: Col[] = srcs.map((s, i) => new Col("t" + i, s));

function asAny(o: any): any {
  return o;
}

for (const c of cols) {
  const o = asAny(c);
  console.log("keys", Object.keys(o).join(","));
  const vals: any[] = Object.values(o);
  console.log("values", vals.map((v: any) => (Object.is(v, -0) ? "-0" : String(v))).join("|"));
  console.log("entries", JSON.stringify(Object.entries(o)));
  console.log("json", JSON.stringify(o));
  console.log("inspect", inspect(o));
    console.log("assign", JSON.stringify(Object.assign({}, o)));
  console.log("hasOwn", Object.hasOwn(o, "start"), Object.hasOwn(o, "len"), "start" in o);
  const d = Object.getOwnPropertyDescriptor(o, "start") as any;
  console.log("desc", d.enumerable, d.writable, d.configurable, Object.is(d.value, c.start), typeof d.value);
  console.log("names", Object.getOwnPropertyNames(o).join(","));
  console.log("span", c.span());
}
