// Positive control for the post-collection trim: 1,000 held 92-member objects dropped, TURNS timer turns that make cyclic array garbage so the collector runs, then 1,000 two-member objects held. Census OBJ row at exit: cap 2,000 with the trim, 128,000 without (RSS does not move: malloc cannot reuse 2.9 KB chunks for the 5 KB strings).
// burst of 1,000 held 92-member dyn objects, dropped, a timer turn, then 1,000 two-member objects held.
const fs = require("fs");
function rss() { const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync("/proc/self/status", "utf8")); return Number(m[1]); }
const holder = [];
const TURNS = Number(process.env.TURNS || 20);
function cyc() { for (let j = 0; j < 300; j++) { const a = JSON.parse("[]"); a.push(a); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mk() { const o = JSON.parse("{}"); for (let k = 0; k < 92; k++) o["k" + k] = k; return o; }
async function main() {
  const r0 = rss();
  let big = [];
  for (let i = 0; i < 1000; i++) big.push(mk());
  const r1 = rss();
  big = null;
  for (let i = 0; i < TURNS; i++) { cyc(); await sleep(1); }
  const keep = [];
  for (let i = 0; i < 1000; i++) keep.push(JSON.parse('{"a":1,"b":2}'));
  await sleep(5);
  const r2 = rss();
  const other = [];
  for (let i = 0; i < 1000; i++) other.push("y".repeat(5000) + i);
  await sleep(5);
  const r3 = rss();
  console.error("rss_kb start", r0, "burst", r1, "after-small", r2, "after-5MB-strings", r3, "keep", other.length);
  holder.push(keep, other);
  console.log(keep.length, Object.keys(keep[3]).length);
}
main().then(() => setTimeout(() => { console.log(holder.length); process.exit(0); }, 5));
