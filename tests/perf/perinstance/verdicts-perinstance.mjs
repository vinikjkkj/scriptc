import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rows = Array.isArray(j) ? j : (j.results ?? j.rows ?? []);
const tag = process.argv[3] ?? process.argv[2];
const by = (f) => { const m = {}; for (const r of rows) { const k = f(r); m[k] = (m[k]||0)+1; } return m; };
console.log(tag, "n=" + rows.length, JSON.stringify(by(r => r.verdict)));
const div = rows.filter(r => r.verdict === "DIVERGE");
const silent = div.filter(r => (r.advisories ?? []).length === 0);
console.log("  DIVERGE", div.length, "of which SILENT", silent.length);
const cby = {}; for (const r of rows) { const c = r.cell.split("__")[0]; (cby[c] ??= {})[r.verdict] = ((cby[c] ??= {})[r.verdict]||0)+1; }
for (const [c, v] of Object.entries(cby)) console.log("   ", c.padEnd(9), JSON.stringify(v));
