// Integer-like keys enumerate first and ascending however they were written; the keys written after them follow in write
// order. A record with such names must not list its keys by write order alone.
interface Bins { "0"?: string; "1"?: string; "7"?: string; x?: string; y?: string }
const b: Bins = {};
b.y = "y";
b["7"] = "seven";
b.x = "x";
b["1"] = "one";
b["0"] = "zero";
console.log(JSON.stringify(b), Object.keys(b).join(","), Object.values(b).join(","));
console.log(b);
for (const k in b) console.log(k);
delete b["1"];
b["1"] = "again";
console.log(Object.entries(b).map(([k, v]) => k + "=" + v).join(";"));

// copies and a widening keep the same order
const c = { ...b };
console.log(Object.keys(c).join(","), JSON.stringify(c));
const w: unknown = b;
console.log(Object.keys(w as object).join(","));
