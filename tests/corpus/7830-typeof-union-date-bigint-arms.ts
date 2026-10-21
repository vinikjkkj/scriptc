// `typeof` over a union that carries a Date arm (and bigint, Buffer, Uint8Array,
// Map, Set arms): the bare value form, the switch form and the narrowing tests
// all answer by the arm's tag. A Date can only be constructed through the
// composed forms today, so the Date arm is never inhabited here; the test is
// still the exact tag chain, and `instanceof Date` is the OR of the Date tags.
type V = string | number | bigint | boolean | Date | Buffer | Uint8Array | Map<string, number> | Set<string> | null | undefined;

function kind(v: V): string {
  switch (typeof v) {
    case "string": return "s:" + v;
    case "number": return "n:" + v;
    case "bigint": return "b:" + String(v);
    case "boolean": return v ? "yes" : "no";
    case "undefined": return "undef";
    case "object":
      if (v === null) return "null";
      if (v instanceof Date) return "date";
      if (v instanceof Map) return "map" + v.size;
      if (v instanceof Set) return "set" + v.size;
      if (Buffer.isBuffer(v)) return "buf" + v.length;
      return "bytes" + (v as Uint8Array).length;
    default: return "other";
  }
}
const samples: V[] = [
  "a", 1.5, 7n, true, false, undefined, null,
  new Map<string, number>([["k", 1]]), new Set<string>(["x", "y"]),
  Buffer.from("abc"), new Uint8Array([1, 2]),
];
for (const s of samples) console.log(kind(s), typeof s);

function isObj(v: V): boolean {
  return typeof v === "object" && v !== null;
}
console.log(isObj(1), isObj(null), isObj(new Map<string, number>()), isObj(Buffer.from("q")));

function plain(v: V): string {
  if (v instanceof Date) return "date";
  if (typeof v === "object" && v !== null) return "object";
  return "scalar:" + String(v);
}
console.log(plain(3), plain("z"), plain(null), plain(undefined), plain(9n), plain(true), plain(Buffer.from("a")));
