// sites.mjs — per-entry refusal-site dump for the pkgstatus survey.
//   node sites.mjs <entry.ts> <out.json> [flags...]
// flags: --provenance-sources | --npm-static <a,b> | --dynamic
// Mirrors packages/cli/src/main.ts's `coverage` path exactly: same analyze(),
// same provenance resolution order (resolve BEFORE the program loads).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const WT = process.env.WT ?? "G:/blocks/pkgrecheck";
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

// INSTRUMENT HARDENING. Two scanners in this tree went blind by returning an
// empty set after the shape they parsed gained/changed fields. This one must
// be unable to write a record that merely LOOKS like "found nothing".
if (!err) {
  if (cov === undefined || cov === null) throw new Error("BLIND: analyze() returned no coverage object");
  const st = cov.stats;
  if (st === undefined || st === null) throw new Error("BLIND: coverage.stats missing -- shape changed");
  for (const k of ["statementsTotal", "statementsFailed", "statementsIsland"]) {
    if (typeof st[k] !== "number") throw new Error(`BLIND: coverage.stats.${k} is ${typeof st[k]}, not a number -- shape changed`);
  }
  if (typeof cov.preflightFailed !== "boolean") throw new Error("BLIND: coverage.preflightFailed is not a boolean -- shape changed");
  if (!Array.isArray(cov.diagnostics)) throw new Error("BLIND: coverage.diagnostics is not an array -- shape changed");
  // A site with no code or no message means the diagnostic shape moved under us.
  for (const s of sites) {
    if (typeof s.code !== "string" || s.code.length === 0) throw new Error("BLIND: a site carries no code");
    if (typeof s.message !== "string" || s.message.length === 0) throw new Error("BLIND: a site carries no message");
  }
  // statementsTotal 0 with NO blocker at all is neither islanded nor analysed;
  // it is the shape a broken query produces. Let it through only when the
  // module really is type-only (no statements, no diagnostics, no fences).
  if (st.statementsTotal === 0 && !cov.preflightFailed && sites.length === 0
      && (texts === undefined || texts.size === 0)) {
    throw new Error("BLIND: zero statements, zero sites and zero source texts -- the query read nothing");
  }
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
