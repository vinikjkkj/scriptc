// sites.mjs — per-entry refusal-site dump for the pkgstatus survey.
//   node sites.mjs <entry.ts> <out.json> [flags...]
// flags: --provenance-sources | --npm-static <a,b> | --dynamic
// Mirrors packages/cli/src/main.ts's `coverage` path exactly: same analyze(),
// same provenance resolution order (resolve BEFORE the program loads).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const WT = process.env.WT ?? "G:/blocks/pkgstatus";
const { analyze } = await import(`file:///${WT}/packages/compiler/dist/index.js`);

const argv = process.argv.slice(2);
const entry = resolve(argv[0]);
const out = resolve(argv[1]);
const rest = argv.slice(2);

let provenance = false;
let dynamic = false;
const npmStaticRaw = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--provenance-sources") provenance = true;
  else if (rest[i] === "--dynamic") dynamic = true;
  else if (rest[i] === "--npm-static") npmStaticRaw.push(...rest[++i].split(","));
  else if (rest[i].startsWith("--npm-static=")) npmStaticRaw.push(...rest[i].slice(13).split(","));
}

const notes = [];
if (provenance) {
  const { resolveProvenanceSources, setProvenanceSources } = await import(`file:///${WT}/packages/compiler/dist/index.js`);
  const p = await resolveProvenanceSources(entry);
  setProvenanceSources(p);
  for (const pkg of p.packages) notes.push(`${pkg.name}@${pkg.version} <- ${pkg.commit.slice(0, 12)}`);
  for (const n of p.notes) notes.push(`note: ${n}`);
}

let npmStatic;
if (npmStaticRaw.includes("auto")) npmStatic = "auto";
else if (npmStaticRaw.length > 0) npmStatic = npmStaticRaw;

const t0 = Date.now();
let cov, texts = new Map(), err = null;
try {
  const r = analyze(entry, { dynamic, ...(npmStatic !== undefined ? { npmStatic } : {}) });
  cov = r.coverage;
  texts = r.sourceTexts ?? new Map();
} catch (e) {
  err = { name: e?.name ?? "?", message: String(e?.message ?? e), stack: String(e?.stack ?? "").split("\n").slice(0, 6).join("\n") };
}
const elapsedMs = Date.now() - t0;

// SrcLoc carries a character OFFSET, not a line. A survey keyed on
// (file, line, code, message) that reads d.loc.line gets 0 for every site and
// silently collapses every site in a file into one.
const lineIndex = new Map();
const lineOf = (file, start) => {
  if (typeof start !== "number") return 0;
  let idx = lineIndex.get(file);
  if (idx === undefined) {
    const t = texts.get(file) ?? texts.get(file.replace(/\//g, "\\")) ?? texts.get(file.replace(/\\/g, "/"));
    if (t === undefined) { lineIndex.set(file, null); return 0; }
    idx = [];
    for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) idx.push(i);
    lineIndex.set(file, idx);
  }
  if (idx === null) return 0;
  let lo = 0, hi = idx.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (idx[m] < start) lo = m + 1; else hi = m; }
  return lo + 1;
};
const sites = [];
const push = (section, ds) => {
  for (const d of ds ?? []) {
    const f = d.loc?.file ?? "";
    sites.push({
      section,
      code: d.code,
      message: d.message,
      file: f.replace(/\\/g, "/"),
      line: lineOf(f, d.loc?.start),
    });
  }
};
if (cov) {
  push("blocker", cov.diagnostics);
  push("runtimeFence", cov.runtimeFences);
  push("advisory", cov.advisories);
  push("unreached", cov.unreached?.diagnostics);
}

const rec = {
  entry: entry.replace(/\\/g, "/"),
  flags: rest,
  elapsedMs,
  crashed: err,
  preflightFailed: cov?.preflightFailed ?? null,
  stats: cov?.stats ?? null,
  unreachedStats: cov?.unreached?.stats ?? null,
  npmStatic: cov?.npmStatic ?? null,
  provenanceNotes: notes.length > 0 ? notes : null,
  sites,
};
writeFileSync(out, JSON.stringify(rec, null, 1));
console.log(
  `sites=${sites.length} preflightFailed=${rec.preflightFailed} total=${rec.stats?.statementsTotal ?? "-"} failed=${rec.stats?.statementsFailed ?? "-"} island=${rec.stats?.statementsIsland ?? "-"} ms=${elapsedMs}${err ? " CRASHED=" + err.message : ""}`,
);
