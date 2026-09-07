// Identity-level diff for a substitution probe. Site COUNTS cannot tell "these
// ten shared a cause" from "ten happened to move"; only (section, code, file,
// line) can. The probe tree is a copy, so its path segment is normalised back.
import { readFileSync } from "node:fs";
const BS = String.fromCharCode(92);
const norm = (p) =>
  String(p).split(BS).join("/").replace("/voipB/", "/voip/").replace(/^.*\/pkgsrc\//, "");
const key = (s) => [s.section, s.code, norm(s.file), s.line].join("|");
const load = (f) => new Map(JSON.parse(readFileSync(f, "utf8")).sites.map((s) => [key(s), s]));
const A = load(process.argv[2]);
const B = load(process.argv[3]);
const gone = [...A].filter(([k]) => !B.has(k));
const added = [...B].filter(([k]) => !A.has(k));
const show = (label, rows) => {
  console.log(`  ${label}: ${rows.length}`);
  for (const [, s] of rows) {
    console.log(`    ${s.section.padEnd(11)}${s.code}  ${norm(s.file)}:${s.line}`);
    console.log(`        ${s.message.slice(0, 96)}`);
  }
};
console.log(`  baseline sites=${A.size}   probe sites=${B.size}`);
show("CLEARED by the substitution", gone);
show("NEWLY APPEARING", added);
