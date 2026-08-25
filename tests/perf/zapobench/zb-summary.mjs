// zb-summary.mjs — aggregate every runner metrics JSON in raw/ into one table.
//
//   node zb-summary.mjs <rawDir> [--json <out>]
//
// Groups runs by arm (the label with its trailing "-<n>" stripped) and reports,
// per arm: peak working set as min / median / max plus the SPREAD, and CPU the
// same way.  Memory is quoted as a number because peak working set on this
// workload resolves to well under 1% run to run.  CPU is quoted as a RANGE
// because it does not: Windows accounts CPU in 15.625 ms scheduler ticks and
// this client only uses ~1.5 s of it, so one tick is ~1% before any contention.
// Wall clock is reported but is the WORST of the three — the run is paced by
// fixed protocol windows, so it is nearly constant by construction and carries
// no information about the program's speed.
//
// The console log beside each metrics file is read too, so every row carries
// its own stanza count, tag multiset, client exit code, untagged-abort count
// and SCTRAP count.  A memory number from a run that did not complete the
// protocol is not a number, and this is where that gets caught.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "raw";
const jsonIdx = process.argv.indexOf("--json");

const files = readdirSync(dir).filter((f) => f.endsWith(".metrics.json"));
const rows = [];
for (const f of files) {
  const label = f.replace(/\.metrics\.json$/, "");
  let m;
  try { m = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
  let stanzas = null, tags = null, exit = null, untagged = null, sctrap = null;
  try {
    const con = readFileSync(join(dir, label + ".console"), "utf8");
    stanzas = /CMP stanza\.count=(\d+)/.exec(con)?.[1] ?? null;
    tags = /CMP stanza\.tags=(.+)/.exec(con)?.[1]?.trim() ?? null;
    exit = /D> client exit=(\S+)/.exec(con)?.[1] ?? null;
    untagged = /UNTAGGED ABORT lines\((\d+)\)/.exec(con)?.[1] ?? null;
    sctrap = /SCTRAP lines\((\d+)\)/.exec(con)?.[1] ?? null;
  } catch { /* no console beside it */ }
  const arm = label.replace(/-\d+$/, "");
  rows.push({
    label, arm,
    peakWS: m.peakWorkingSetBytes, peakPF: m.peakPagefileBytes,
    cpuMs: m.cpuTotalMs, wallMs: m.wallMs, exitCode: m.exit,
    pageFaults: m.pageFaults,
    stanzas, tags, exit, untagged, sctrap,
  });
}

const arms = new Map();
for (const r of rows) {
  if (!arms.has(r.arm)) arms.set(r.arm, []);
  arms.get(r.arm).push(r);
}

const stat = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { min: s[0], med, max: s[s.length - 1], n: s.length, spread: s[0] ? (s[s.length - 1] - s[0]) / s[0] : 0 };
};

const out = [];
console.log("arm                 n   peakWS med (B)      min          max     spread   cpuMs med   cpuMs range      wall med  stanzas  exits  untagged/SCTRAP");
for (const [arm, rs] of [...arms.entries()].sort()) {
  const ws = stat(rs.map((r) => r.peakWS));
  const cpu = stat(rs.map((r) => r.cpuMs));
  const wall = stat(rs.map((r) => r.wallMs));
  const stanzaSet = [...new Set(rs.map((r) => r.stanzas))].join("/");
  const exits = [...new Set(rs.map((r) => String(r.exitCode)))].join("/");
  const ut = [...new Set(rs.map((r) => r.untagged))].join("/");
  const st = [...new Set(rs.map((r) => r.sctrap))].join("/");
  const tagSet = [...new Set(rs.map((r) => r.tags))];
  console.log(
    arm.padEnd(18) + String(ws.n).padStart(3) +
    String(ws.med).padStart(14) + String(ws.min).padStart(13) + String(ws.max).padStart(13) +
    (ws.spread * 100).toFixed(2).padStart(8) + "%" +
    cpu.med.toFixed(1).padStart(11) + (cpu.min.toFixed(0) + "-" + cpu.max.toFixed(0)).padStart(14) +
    (wall.med / 1000).toFixed(2).padStart(12) + "s" +
    stanzaSet.padStart(8) + exits.padStart(7) + ("  " + ut + "/" + st).padStart(12) +
    (tagSet.length > 1 ? "  TAGS DIFFER" : ""));
  out.push({ arm, n: ws.n, peakWS: ws, cpuMs: cpu, wallMs: wall, stanzas: stanzaSet, exits, untagged: ut, sctrap: st, tagSets: tagSet, runs: rs });
}
if (jsonIdx > 0) writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(out, null, 1));
