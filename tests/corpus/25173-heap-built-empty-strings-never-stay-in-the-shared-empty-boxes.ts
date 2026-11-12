// The shared empty-string union box and the shared empty dyn string must never keep a COUNTED (heap) empty string alive: an empty value read from the
// environment or decoded from a query string is a heap string, and the sanitize lane's RC audit fails the run if one is still alive at exit.
// Each such empty crosses into a string arm of a union and into the dynamic copy of a union array.
import { parse } from "node:querystring";
type V = string | number | null;
process.env["SB_EMPTY_ENV"] = "";
const held: unknown[] = [];
function consume(params: unknown): number { held.push(params); return JSON.stringify(params).length; }
const vals: V[] = [];
const fromEnv = process.env["SB_EMPTY_ENV"];
vals.push(fromEnv === undefined ? null : fromEnv);
const q = parse("a=&b=1&c=&d=x");
for (const k of ["a", "b", "c", "d"]) {
  const x = q[k];
  if (typeof x === "string") vals.push(x);
}
vals.push("");
vals.push(0);
vals.push(-1);
console.log(vals.map((v) => (v === null ? "null" : typeof v === "number" ? "n" + v : "s" + v.length)).join(","));
console.log(consume(vals), JSON.stringify(held[0]));
let empties = 0;
for (const v of vals) if (v === "") empties++;
console.log(empties, vals.length);
