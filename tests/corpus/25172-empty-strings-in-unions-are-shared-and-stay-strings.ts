// The empty string as a union payload is one shared immortal box per arm tag. It must behave as the empty string everywhere: length, concatenation,
// comparison, keys, JSON, typeof, truthiness, and alongside every other string and non-string arm of the same union.
type S = string | number | null;
type T = string | boolean;
const es: S[] = ["", "", 0, null, "a", ""];
const out: string[] = [];
for (const e of es) {
  if (e === null) out.push("null");
  else if (typeof e === "number") out.push("n" + e);
  else out.push("s" + e.length + (e === "" ? "E" : "N") + (e ? "T" : "F") + (e + "!") );
}
console.log(out.join(" "));
const ts: T[] = ["", true, "", false, "q"];
console.log(ts.map((t) => (typeof t === "string" ? "[" + t + "]" : String(t))).join(""));
const m = new Map<string, S>();
for (let i = 0; i < 5; i++) m.set("k" + i, i % 2 === 0 ? "" : i);
let empties = 0, nums = 0;
for (const [, v] of m) { if (v === "") empties++; else if (typeof v === "number") nums++; }
console.log(empties, nums, JSON.stringify([...m.entries()]));
let cur: S = "";
const parts: string[] = [];
for (let i = 0; i < 6; i++) { cur = i % 3 === 0 ? "" : i % 3 === 1 ? "v" + i : null; parts.push(cur === null ? "null" : "<" + cur + ">"); }
console.log(parts.join(","));
const many: S[] = [];
for (let i = 0; i < 30000; i++) many.push(i % 100 === 0 ? "x" + i : "");
let nonEmpty = 0;
for (const v of many) if (v !== "") nonEmpty++;
console.log(nonEmpty, many.length);
many.length = 0;
console.log(JSON.stringify(es));
