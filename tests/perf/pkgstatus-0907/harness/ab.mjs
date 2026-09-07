/* Generate the A/B result block from the four records, so the comparison is
 * read off the files rather than typed. Refuses to write a block if an arm is
 * missing -- a half-run A/B is not a result. */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
const LAB = "<blocks>/pkgstatus3-lab/sites";
const rd = (n) => {
  const p = `${LAB}/${n}.json`;
  if (!existsSync(p)) return null;
  const r = JSON.parse(readFileSync(p, "utf8"));
  const b = r.sites.filter((s) => s.section === "blocker");
  const tree = {};
  for (const s of b) {
    const m = /([0-9a-f]{40})/.exec(String(s.file).split(String.fromCharCode(92)).join("/"));
    // A monorepo checkout holds BOTH zapo-js core (src/) and the package
    // (packages/<name>/). Labelling the whole checkout by its tag conflates the
    // shared core cluster with the package's own code -- the exact conflation
    // this document exists to undo.
    const fp = String(s.file).split(String.fromCharCode(92)).join("/");
    const inPkg = /[0-9a-f]{40}\/packages\//.test(fp);
    const inCore = /[0-9a-f]{40}\/(src|spec)\//.test(fp);
    const k = !m ? "the driver"
      : inPkg ? "the package's own source"
      : inCore ? (m[1].startsWith("9a49e1") ? "zapo-js core (v1.8.0)" : "zapo-js core (v1.8.2)")
      : m[1].slice(0, 8);
    tree[k] = (tree[k] ?? 0) + 1;
  }
  return { sites: b.length, stmts: r.stats?.statementsTotal, failed: r.stats?.statementsFailed, tree,
           notes: (r.provenanceNotes ?? []).filter((n) => /<-/.test(n)) };
};
const arms = [
  ["store-sqlite", "_x-sqlite-plus-zapo", "store-sqlite"],
  ["store-redis", "_x-redis-plus-zapo", "store-redis"],
];
const rows = [];
for (const [label, plus, base] of arms) {
  const A = rd(base), B = rd(plus);
  if (!A || !B) { console.error(`MISSING ARM for ${label}; not writing`); process.exit(2); }
  rows.push([label, A, B]);
}
const L = [];
L.push("| package | driver imports | statements / failed | blocker sites | where those sites are |");
L.push("|---|---|---|---|---|");
for (const [label, A, B] of rows) {
  L.push(`| \`${label}\` | the store package only | ${A.stmts} / ${A.failed} | **${A.sites}** | ${Object.entries(A.tree).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
  L.push(`| \`${label}\` | **+ \`zapo-js\`** (app182's shape) | ${B.stmts} / ${B.failed} | **${B.sites}** | ${Object.entries(B.tree).map(([k, v]) => `${k} ${v}`).join(", ") || "-"} |`);
}
L.push("");
L.push("Provenance notes on the `+ zapo-js` arms:");
L.push("");
for (const [label, , B] of rows) for (const n of B.notes) L.push(`- \`${label}\`: ${n}`);
writeFileSync("<blocks>/pkgstatus3-lab/ab-result.md", L.join("\n") + "\n");
console.log(L.join("\n"));
