// tally2.mjs -- block wamcoord. Blocker census with the clustering the brief
// requires: roots vs SC2004 cascade, DISTINCT MESSAGES, and the by-file cluster.
// Prints the byte size of the file it scanned beside every count.
import { readFileSync, statSync } from "node:fs";
const f = process.argv[2];
const bytes = statSync(f).size;
const j = JSON.parse(readFileSync(f, "utf8"));
const all = j.sites ?? [];
const blockers = all.filter((s) => s.section === "blocker");
const cascade = blockers.filter((s) => s.code === "SC2004");
const roots = blockers.filter((s) => s.code !== "SC2004");
const msgs = new Map();
for (const s of roots) {
  const k = `${s.code} ${s.message}`;
  msgs.set(k, (msgs.get(k) ?? 0) + 1);
}
const short = (p) => {
  const s = String(p).split("\\").join("/");
  const m = /\/(napp\/.*|packages\/.*)$/.exec(s);
  if (m) return m[1];
  const h = /[0-9a-f]{40}\/(.*)$/.exec(s);
  if (h) return "<prov>/" + h[1];
  return s;
};
const byFile = new Map();
for (const s of roots) {
  const k = short(s.file);
  byFile.set(k, (byFile.get(k) ?? 0) + 1);
}
const sect = new Map();
for (const s of all) sect.set(s.section, (sect.get(s.section) ?? 0) + 1);
console.log(`FILE ${f}  bytes=${bytes}`);
console.log(`entry=${j.entry}`);
console.log(`preflightFailed=${j.preflightFailed} crashed=${j.crashed} elapsedMs=${j.elapsedMs}`);
console.log(`stats=${JSON.stringify(j.stats)}`);
console.log(`sections: ${[...sect].map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log(
  `BLOCKER-SITES total=${blockers.length}  roots=${roots.length}  cascade(SC2004)=${cascade.length}  distinctRootMessages=${msgs.size}`,
);
console.log("--- roots by distinct message (count, code, message) ---");
for (const [k, v] of [...msgs].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k.slice(0, 160)}`);
console.log("--- roots clustered by file ---");
for (const [k, v] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log("--- provenance notes ---");
for (const n of j.provenanceNotes ?? []) console.log(`  ${n}`);
