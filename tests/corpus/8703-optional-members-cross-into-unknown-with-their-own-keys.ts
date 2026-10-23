// A record with optional members crossing into `unknown` (or `any`) builds a
// dynamic object out of the members the record OWNS: an explicit undefined is
// a key of it, a never-written member is not.
interface P {
  a?: number;
  b?: string;
  c?: number;
}
const absent: P = { c: 3 };
const explicit: P = { a: undefined, c: 3 };
const written: P = {};
written.a = undefined;
written.b = "x";
const keysOf = (v: unknown): string => {
  const o = v as Record<string, unknown>;
  return Object.keys(o).join(",") + "|" + JSON.stringify(o);
};
console.log(keysOf(absent));
console.log(keysOf(explicit));
console.log(keysOf(written));
const loose: any = explicit;
console.log("a" in loose, "b" in loose, loose.a, loose.c);
const items: unknown[] = [absent, explicit, written];
console.log(items.map(keysOf));
console.log(absent, explicit, written);
