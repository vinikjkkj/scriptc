/* corpuslower-keyorder.mjs — lower every corpus program and record its
 * diagnostics + advisories. Run once per tree; diff the two JSONs to see
 * exactly which programs a refusal newly claims. Lowering only: this finds
 * REGRESSIONS in what compiles, never proves a value correct — that is what
 * the Node-oracle sweep and coverage.test.ts are for.
 * Usage: node corpuslower-keyorder.mjs <repoRoot> <out.json>
 */
import { readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.argv[2];
const out = process.argv[3];
const { loadProgram } = await import(pathToFileURL(join(repo, "packages/compiler/dist/frontend/program.js")).href);
const { lowerToIr } = await import(pathToFileURL(join(repo, "packages/compiler/dist/frontend/lowering/lowerer.js")).href);

const dir = join(repo, "tests/corpus");
const entries = [];
for (const name of readdirSync(dir).sort()) {
  const p = join(dir, name);
  if (statSync(p).isDirectory()) {
    for (const inner of ["main.ts", "index.ts", "main.js"]) {
      try { if (statSync(join(p, inner)).isFile()) { entries.push(join(p, inner)); break; } } catch { /* none */ }
    }
    continue;
  }
  if (/\.(ts|js|mjs|cjs)$/.test(name)) entries.push(p);
}

const results = {};
let i = 0;
for (const entry of entries) {
  i++;
  if (i % 100 === 0) process.stderr.write(`\r${i}/${entries.length}   `);
  let load = null;
  try {
    load = loadProgram(entry);
    const r = lowerToIr(load.program, load.entry, load.moduleOrder);
    results[entry.slice(dir.length + 1).split(String.fromCharCode(92)).join("/")] = {
      ok: r.module !== null,
      diags: r.diagnostics.map((d) => d.code).sort(),
      adv: r.advisories.map((d) => d.code).sort(),
    };
  } catch (e) {
    results[entry.slice(dir.length + 1).split(String.fromCharCode(92)).join("/")] = { ok: false, threw: String(e && e.message).slice(0, 120), diags: [], adv: [] };
  } finally {
    load?.dispose();
  }
}
process.stderr.write("\n");
writeFileSync(out, JSON.stringify(results, null, 1));
console.log(`${entries.length} corpus entries -> ${out}`);
