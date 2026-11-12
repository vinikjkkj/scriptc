// -1, 0, 1 and both bools as union payloads come from shared immortal boxes; everything that merely LOOKS like them must still be its own value:
// -0 (printed as 0, but 1/x is -Infinity), NaN, 2, 0.5, 1.0000000000000002, and the same payload under a different arm tag. A shared box is also
// held, copied, reassigned between arms and dropped in volume, which must neither free it nor change it.
type N = number | string | boolean | null;
type M = number | boolean | string[];
function sign(x: number): string { return x === 0 ? (1 / x < 0 ? "-0" : "+0") : String(x); }
function show(v: N): string { return typeof v === "number" ? "n:" + sign(v) : typeof v === "string" ? "s:" + v : v === null ? "null" : "b:" + String(v); }
const vals: N[] = [-1, 0, 1, -0, NaN, 2, 0.5, 1.0000000000000002, -1.0000000000000002, true, false, null, "", "x"];
const out: string[] = [];
for (const v of vals) out.push(show(v));
console.log(out.join(" "));

// the same number under two different unions (different tags) stays right
const m1: M = -1, m2: M = 1, m3: M = true, m4: M = false, m5: M = 0;
const mm: M[] = [m1, m2, m3, m4, m5, ["a"]];
console.log(mm.map((x) => (typeof x === "number" ? "n" + x : typeof x === "boolean" ? "b" + x : "a" + x.length)).join(","));

// reassigning a variable across arms and back
let cur: N = 0;
const trail: string[] = [];
for (let i = 0; i < 12; i++) {
  cur = i % 4 === 0 ? 0 : i % 4 === 1 ? -1 : i % 4 === 2 ? true : "t" + i;
  trail.push(show(cur));
}
console.log(trail.join("|"));

// volume: many boxes of the common constants, held and then dropped, interleaved with distinct values
const held: N[] = [];
for (let i = 0; i < 20000; i++) held.push(i % 5 === 0 ? -1 : i % 5 === 1 ? 0 : i % 5 === 2 ? 1 : i % 5 === 3 ? i : i % 2 === 0);
let acc = 0, bools = 0;
for (const h of held) { if (typeof h === "number") acc += h; else if (typeof h === "boolean") bools++; }
console.log(acc, bools, held.length);
held.length = 0;
const again: N[] = [];
for (let i = 0; i < 1000; i++) again.push(-1);
console.log(again.every((x) => x === -1), again.length);

// JSON round trip of a union array of constants
console.log(JSON.stringify([-1, 0, 1, true, false, null, "", "z"] as N[]));
