/* Read the rotated fanout runs and report BOTH columns, with the dispersion
 * discipline this bench requires: if the arms' observed ranges overlap, say
 * the design does not separate the effect from the draw instead of quoting a
 * median ratio. */
import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2];
const rows = readFileSync(dir + "/summary.txt", "utf8").trim().split(/\r?\n/)
  .map(l => l.match(/^(\w+) (\d+) samples=(\d+) peakPC=(\d+) peakWS=(\d+) setPC=(\d+) setWS=(\d+) :: (.*)$/))
  .filter(Boolean)
  .map(m => ({ arm: m[1], rep: +m[2], n: +m[3], peakPC: +m[4], peakWS: +m[5],
               setPC: +m[6], setWS: +m[7], fib: m[8] }));
const MiB = 1048576;
const by = a => rows.filter(r => r.arm === a);
function stat(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length/2 - 1] + s[s.length/2]) / 2;
  return { n: s.length, min: s[0], med, max: s[s.length - 1] };
}
function line(label, key) {
  const A = stat(by("off").map(r => r[key]));
  const B = stat(by("on").map(r => r[key]));
  const f = v => (v / MiB).toFixed(2).padStart(8);
  console.log(`  ${label}`);
  console.log(`    fiber     n=${A.n} median ${f(A.med)} MiB  [min ${f(A.min)}  max ${f(A.max)}]`);
  console.log(`    stackless n=${B.n} median ${f(B.med)} MiB  [min ${f(B.min)}  max ${f(B.max)}]`);
  const sep = A.min > B.max || B.min > A.max;
  if (!sep) {
    console.log(`    RANGES OVERLAP -- this design does not separate the effect from the draw; no delta quoted`);
  } else {
    const d = (A.med - B.med) / MiB;
    console.log(`    SEPARATED: ${d >= 0 ? "-" : "+"}${Math.abs(d).toFixed(2)} MiB (${(100*(A.med-B.med)/A.med).toFixed(1)}%)`);
  }
}
console.log(`reps: off=${by("off").length} on=${by("on").length}\n`);
line("PEAK privateCommit", "peakPC");
line("PEAK workingSet", "peakWS");
line("SETTLED privateCommit", "setPC");
line("SETTLED workingSet", "setWS");
console.log("\nlive fiber stacks at peak (external walk, peakStacks):");
for (const a of ["off", "on"]) {
  const f = [...new Set(by(a).map(r => (r.fib.match(/peakStacks=(\d+)/) || [])[1]))];
  console.log(`  ${a.padEnd(9)} ${f.sort((x,y)=>x-y).join(", ") || "n/a"}`);
}
