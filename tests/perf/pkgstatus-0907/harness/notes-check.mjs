/* Cross-check the claims made about provenance notes, so none is asserted
 * from memory. Prints the note lines that carry each claim. */
import { readFileSync, readdirSync } from "node:fs";
const LAB = "<blocks>/pkgstatus3-lab/sites";
const recs = readdirSync(LAB).filter((f) => f.endsWith(".json") && !f.startsWith("_ctl"));
const tally = {};
for (const f of recs) {
  const r = JSON.parse(readFileSync(`${LAB}/${f}`, "utf8"));
  for (const n of r.provenanceNotes ?? []) {
    const pkg = /^(?:note: )?((?:@[^/@ ]+\/)?[^@ :]+)/.exec(n)?.[1] ?? "?";
    const kind = /no provenance attestation/.test(n) ? "no-attestation"
      : /no source mapping/.test(n) ? "no-source-mapping"
      : /not installed/.test(n) ? "not-installed"
      : /package limit/.test(n) ? "package-limit"
      : /<-/.test(n) ? "MAPPED" : "other";
    (tally[`${pkg} :: ${kind}`] ??= []).push(f.replace(".json", ""));
  }
}
console.log(`records scanned: ${recs.length}  (${recs.map((f) => f.replace(".json", "")).join(", ")})\n`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(v.length).padStart(3)}  ${k.padEnd(52)} ${v.join(" ")}`);
}
