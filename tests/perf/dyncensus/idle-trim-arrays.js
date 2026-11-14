// Positive control for the post-collection trim (scr_dyn_idle_trim, run at the end of scr_collect_cycles): 1,000 held padded arrays dropped, then TURNS (default 20) timer turns that each make 300 cyclic garbage objects so the collector runs, then 1,000 small arrays held. Census ARR row at exit: cap 4,000 over the small arrays with the trim (2 arrays/2,048 slots besides); without it 1,002 arrays hold 1,026,048 slots. VmRSS after 5 MB of later strings: 10.8 MB with the trim, 18.1 MB without.
// burst of 1,000 held padded 751-slot arrays, all dropped, a timer turn (the seam), then 1,000 small arrays held. VmRSS is printed after each step.
const fs = require("fs");
function rss() { const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync("/proc/self/status", "utf8")); return Number(m[1]); }
const T = "[" + Array.from({ length: 751 }, () => "true").join(",") + "]";
const holder = [];
const TURNS = Number(process.env.TURNS || 20);
function cyc() { for (let j = 0; j < 300; j++) { const a = JSON.parse("{}"); a.self = a; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const r0 = rss();
  let big = [];
  for (let i = 0; i < 1000; i++) big.push(JSON.parse(T));
  const r1 = rss();
  big = null;
  for (let i = 0; i < TURNS; i++) { cyc(); await sleep(1); }
  const keep = [];
  for (let i = 0; i < 1000; i++) keep.push(JSON.parse("[1,2,3]"));
  await sleep(5);
  const r2 = rss();
  const other = [];
  for (let i = 0; i < 1000; i++) other.push("y".repeat(5000) + i);
  await sleep(5);
  const r3 = rss();
  console.error("rss_kb start", r0, "burst", r1, "after-small", r2, "after-5MB-strings", r3, "keep", other.length);
  holder.push(keep, other);
  console.log(keep.length, keep[5].length);
}
main().then(() => setTimeout(() => { console.log(holder.length); process.exit(0); }, 5));
