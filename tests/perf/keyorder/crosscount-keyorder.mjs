/* crosscount-keyorder.mjs - how SELECTIVE is the crossing fence? Count, over the whole corpus, how
 * many static->dyn crossings the hook sees and how many of them carry a
 * risk. A fence that fired on most crossings would be a different animal
 * from one that fires on a handful. */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.argv[2];  // usage: SCRIPTC_KEYCROSS_WHY=1 node crosscount-keyorder.mjs <repoRoot>
const { loadProgram } = await import(pathToFileURL(join(repo, "packages/compiler/dist/frontend/program.js")).href);
const { lowerToIr } = await import(pathToFileURL(join(repo, "packages/compiler/dist/frontend/lowering/lowerer.js")).href);
const dir = join(repo, "tests/corpus");
const entries = [];
for (const name of readdirSync(dir).sort()) {
  const p = join(dir, name);
  if (statSync(p).isDirectory()) {
    for (const inner of ["main.ts", "index.ts", "main.js"]) { try { if (statSync(join(p, inner)).isFile()) { entries.push(join(p, inner)); break; } } catch { /* none */ } }
    continue;
  }
  if (/\.(ts|js|mjs|cjs)$/.test(name)) entries.push(p);
}
let seen = 0, risky = 0, files = 0, riskyFiles = 0;
const origErr = console.error;
for (const entry of entries) {
  let load = null;
  let n = 0;
  console.error = (s) => { if (typeof s === "string" && s.startsWith("[keycross]")) n++; };
  try {
    load = loadProgram(entry);
    const r = lowerToIr(load.program, load.entry, load.moduleOrder);
    console.error = origErr;
    seen += n;
    files++;
    const rk = r.diagnostics.filter((d) => d.message.includes("widening a record into an")).length
      + r.advisories.filter((d) => d.message.includes("widening into an")).length;
    if (rk > 0) { risky += rk; riskyFiles++; }
  } catch { console.error = origErr; } finally { console.error = origErr; load?.dispose(); }
}
console.log(`corpus files lowered ${files}; crossings the hook SAW ${seen}; crossings that carried a risk ${risky} in ${riskyFiles} file(s)`);
