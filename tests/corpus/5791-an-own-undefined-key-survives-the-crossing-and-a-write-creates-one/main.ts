// The two edges of the own-key mask a checked cast writes.
//
//   an OWN key holding `undefined` is a key JS lists — `Object.keys({a:
//   undefined})` is `["a"]` — while the undefined arm alone (a record's only
//   other presence signal) says "absent";
//
//   a WRITE after the crossing creates an own property, so a member the
//   source object merely inherited becomes one of the value's own keys from
//   that point on.
//
// JSON is the third rule and it is neither: an undefined-VALUED property
// drops from JSON output even when it is own.
import { make } from "./src.js";

interface Rec {
  tag?: string;
  note?: string;
  label?: string;
}

function sorted(a: string[]): string[] {
  return a.slice().sort((x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0));
}
function keysAcross(v: unknown): string {
  const rec = v as Record<string, unknown>;
  return sorted(Object.keys(rec)).join("+");
}

const r: Rec = make() as Rec;
console.log("keys", sorted(Object.keys(r)).join("+"));
console.log("across", keysAcross(r));
console.log("json", JSON.stringify(r));
console.log("hasOwn.note", String(Object.hasOwn(r, "note")));
console.log("hasOwn.label", String(Object.hasOwn(r, "label")));
console.log("read.note", String(r.note));
console.log("read.label", String(r.label));
console.log("read.tag", String(r.tag));

const w: Rec = make() as Rec;
w.label = "written";
console.log("write.keys", sorted(Object.keys(w)).join("+"));
console.log("write.across", keysAcross(w));
console.log("write.json", JSON.stringify(w));
console.log("write.read", String(w.label));
