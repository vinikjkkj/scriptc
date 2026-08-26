#!/usr/bin/env node
/* sites.mjs — one module's refusal sites, as JSON.
 *   node sites.mjs <entry.ts> <out.json> [--provenance-sources] [--npm-static=a,b]
 * Prints a one-line summary to stdout and writes the full site list.
 * Mirrors the remeasure block's sites.mjs by shape, rebuilt here because
 * that lab was disposable and is gone. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WT = process.env.WT ?? "G:/blocks/wamvoip";
const compiler = await import(pathToFileURL(`${WT}/packages/compiler/dist/index.js`).href);
const provmod = await import(
  pathToFileURL(`${WT}/packages/compiler/dist/frontend/provenance.js`).href
);
const registry = await import(
  pathToFileURL(`${WT}/packages/compiler/dist/frontend/provenance-registry.js`).href
);

const [entry, out, ...flags] = process.argv.slice(2);
if (!entry || !out) {
  console.error("usage: sites.mjs <entry> <out.json> [flags]");
  process.exit(2);
}
const useProv = flags.includes("--provenance-sources");
const npmStaticFlag = flags.find((f) => f.startsWith("--npm-static"));
const npmStatic = npmStaticFlag
  ? npmStaticFlag.includes("=")
    ? npmStaticFlag.slice(npmStaticFlag.indexOf("=") + 1).split(",")
    : "auto"
  : undefined;

const entryPath = resolve(entry);

let provNotes = [];
if (useProv) {
  const p = await provmod.resolveProvenanceSources(entryPath);
  if (p !== null) {
    registry.setProvenanceSources(p);
    provNotes = [
      ...p.packages.map((k) => `${k.name}@${k.version} <- ${k.commit.slice(0, 12)}`),
      ...p.notes,
    ];
  } else {
    provNotes = ["<resolveProvenanceSources returned null>"];
  }
}

const t0 = Date.now();
let res;
try {
  res = compiler.analyze(entryPath, npmStatic ? { npmStatic } : {});
} catch (e) {
  writeFileSync(
    out,
    JSON.stringify({ entry: entryPath, threw: String(e && e.stack ? e.stack : e) }, null, 1),
  );
  console.log(`THREW ${entryPath}`);
  process.exit(1);
}
const cov = res.coverage;
const site = (d) => ({
  code: d.code ?? null,
  file: d.loc?.file ?? null,
  start: d.loc?.start ?? null,
  end: d.loc?.end ?? null,
  message: d.message ?? String(d),
  hint: d.hint ?? null,
});
const payload = {
  entry: entryPath,
  ms: Date.now() - t0,
  provenance: provNotes,
  preflightFailed: cov.preflightFailed,
  stats: cov.stats
    ? {
        statements: cov.stats.statements ?? cov.stats.statementsTotal ?? null,
        failed: cov.stats.statementsFailed ?? null,
        island: cov.stats.statementsIsland ?? null,
      }
    : null,
  npmStatic: cov.npmStatic ?? null,
  sites: (cov.diagnostics ?? []).map(site),
  runtimeFences: (cov.runtimeFences ?? []).map(site),
  ice: (cov.ice ?? []).map(site),
  unreachedFailed: cov.unreached?.stats?.statementsFailed ?? null,
};
writeFileSync(out, JSON.stringify(payload, null, 1));
console.log(
  `preflightFailed=${payload.preflightFailed} stats=${payload.stats?.statements}/${payload.stats?.failed} sites=${payload.sites.length} ms=${payload.ms}`,
);
