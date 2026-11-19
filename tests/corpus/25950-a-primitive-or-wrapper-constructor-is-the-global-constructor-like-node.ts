// `v.constructor === String` (and Number, Boolean) holds for a primitive dyn value and for its wrapper, the global read as a value is the
// same function the `constructor` read answers (one identity: ===, a Map key, a stored copy, name, typeof, a call through the copy).
const s: any = JSON.parse('"x"');
const n: any = JSON.parse("5");
const b: any = JSON.parse("true");
const ws: any = Object("x");
const wn: any = Object(5);
const wb: any = Object(true);
console.log(s.constructor === String, n.constructor === Number, b.constructor === Boolean);
console.log(ws.constructor === String, wn.constructor === Number, wb.constructor === Boolean);
console.log(s.constructor === Number, n.constructor === Boolean, b.constructor === String, ws.constructor === Number);
console.log(String === s.constructor, Number === n.constructor, Boolean === b.constructor, s.constructor !== String);
const c = s.constructor;
console.log(typeof c, c.name, c === String, c === ws.constructor, c === n.constructor);
console.log(c(12), c("z") === "z", typeof c(1));
const m = new Map<any, string>();
m.set(String, "S");
m.set(Number, "N");
m.set(Boolean, "B");
console.log(m.get(s.constructor), m.get(n.constructor), m.get(b.constructor), m.get(wn.constructor), m.size);
const m2 = new Map<any, string>();
m2.set(s.constructor, "x");
console.log(m2.has(String), m2.has(Number), m2.has(ws.constructor));
const stored: any = String;
console.log(stored === s.constructor, stored("q"), stored.name, typeof stored);
function kind(v: any): string {
  if (v.constructor === String) return "string";
  if (v.constructor === Number) return "number";
  if (v.constructor === Boolean) return "boolean";
  return "other";
}
console.log(kind(s), kind(n), kind(b), kind(ws), kind(wn), kind(wb), kind(JSON.parse("{}")));
