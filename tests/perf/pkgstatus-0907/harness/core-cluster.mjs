/* Is the SAME cluster of zapo-js-core blocker sites present in every store
 * package's record? A shared cluster is one fix, not five. */
import { readFileSync } from "node:fs";
const LAB = `${process.env.BLOCKS_ROOT ?? "<blocks>"}/pkgstatus3-lab`;
const key = (s) =>
  `${s.code} ${String(s.file).replace(/\\/g, "/").replace(/^.*?[0-9a-f]{40}\//, "")}:${s.line}`;
const sets = new Map();
for (const p of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(`${LAB}/sites/${p}.json`, "utf8"));
  const core = r.sites.filter(
    // ONLY the zapo monorepo checkout 9a49e1ff (v1.8.0) -- mongodb's own
    // attested tree also has a top-level src/, and counting it here would turn
    // 7 shared sites into 232 and hide the shared cluster entirely.
    (s) => s.section === "blocker" && /9a49e1fffdec[0-9a-f]*\/src\//.test(String(s.file).replace(/\\/g, "/")),
  );
  sets.set(p, core.map(key).sort());
  console.log(`${p.padEnd(16)} core-sites=${core.length}`);
}
const names = [...sets.keys()];
const first = sets.get(names[0]);
let identical = true;
for (const n of names.slice(1)) {
  const a = sets.get(n);
  if (a.length !== first.length || a.some((x, i) => x !== first[i])) identical = false;
}
console.log(`\nIDENTICAL ACROSS ALL ${names.length}: ${identical}`);
for (const k of first) console.log(`  ${k}`);
