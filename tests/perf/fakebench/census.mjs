#!/usr/bin/env node
/* census.mjs — the RANKED BLOCKER MAP, one row per refusal SITE.
 *
 * survey.mjs asks "does it build". That question has a wall in front of
 * it: an unsupported module import, or one TypeScript preflight error,
 * stops the build and everything behind it goes unmeasured. A file that
 * reports one diagnostic is not closer to compiling than a file that
 * reports eighty — it is a file whose eighty nobody has seen.
 *
 * `analyze()` (the compiler's own coverage pass, what `scriptc coverage`
 * prints) lowers the whole graph and collects EVERY refusal, reached and
 * unreached, with its code, message and source position. That is the
 * census this ranks. It also reports statements-analyzed and
 * statements-static per entry, which is the only number on which two
 * files with different failure walls are comparable at all.
 *
 * Every site is attributed to the package that owns its file, so the
 * `zapo-js` cause — the one `block/prov2` already owns — can be ranked
 * separately from everything else.
 *
 *   FB_APP    driver project root
 *   FB_WT     scriptc worktree (for @scriptc/compiler)
 *   FB_OUT    output dir
 *   FB_BENCH  bench dir relative to FB_APP
 *   FB_ONLY   comma-separated entry names
 *   FB_NO_PROVENANCE=1   run the census WITHOUT --provenance-sources
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const APP = resolve(process.env.FB_APP ?? "");
const WT = resolve(process.env.FB_WT ?? "");
const OUT = resolve(process.env.FB_OUT ?? "");
const BENCH = process.env.FB_BENCH ?? "tree/packages/fake-server/bench";
const ONLY = (process.env.FB_ONLY ?? "").split(",").filter((s) => s !== "");
const USE_PROVENANCE = process.env.FB_NO_PROVENANCE !== "1";
const TAG = process.env.FB_TAG ?? (USE_PROVENANCE ? "prov" : "noprov");

if (APP === "" || WT === "" || OUT === "") {
  console.error("census.mjs: FB_APP, FB_WT and FB_OUT must be set");
  process.exit(2);
}

const compilerUrl = pathToFileURL(join(WT, "packages", "compiler", "dist", "index.js")).href;
const { analyze, resolveProvenanceSources, setProvenanceSources } = await import(compilerUrl);

const ENTRIES = [
  "_common.ts",
  "_fixtures.ts",
  "_store-factory.ts",
  "server-rpc.ts",
  "server-process.ts",
  "appstate.bench.ts",
  "bulk-usync.bench.ts",
  "connect-lifecycle.bench.ts",
  "group-provision.bench.ts",
  "history-sync.bench.ts",
  "media-upload.bench.ts",
  "messaging-media.bench.ts",
  "messaging.bench.ts",
  "receipts-flood.bench.ts",
  "reconnect-resume.bench.ts",
  "retry.bench.ts",
  "run-all-stores.cjs",
];

/* ── position ──────────────────────────────────────────────────────────── */

const textCache = new Map();
function lineOf(file, offset) {
  let t = textCache.get(file);
  if (t === undefined) {
    try {
      t = readFileSync(file, "utf8");
    } catch {
      t = null;
    }
    textCache.set(file, t);
  }
  if (t === null || typeof offset !== "number") return { line: null, source: null };
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < t.length; i++) {
    if (t.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  const end = t.indexOf("\n", lineStart);
  return { line, source: t.slice(lineStart, end < 0 ? t.length : end).trim().slice(0, 200) };
}

/* ── ownership ─────────────────────────────────────────────────────────── */

/* Which tree a site's file belongs to. The `zapo-js` bucket is the one
 * `block/prov2` already owns; separating it is the whole point — the
 * interesting number is what blocks these benches BESIDES that. */
function ownerOf(file) {
  const f = file.replace(/\\/g, "/");
  if (/\/packages\/fake-server\/bench(-unmasked)?\//.test(f)) return "bench";
  if (/\/packages\/fake-server\/src\//.test(f)) return "fake-server/src";
  const m = /\/packages\/(store-[a-z]+|wam|voip|media-utils|mcp-server)\//.exec(f);
  if (m !== null) return `@zapo-js/${m[1]}`;
  if (/\/provcache\/|\/tree\/src\//.test(f)) return "zapo-js";
  if (/[/\\]node_modules[/\\]/.test(f)) {
    const nm = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(f);
    return `npm:${nm?.[1] ?? "?"}`;
  }
  return "other";
}

/* ── the run ───────────────────────────────────────────────────────────── */

mkdirSync(OUT, { recursive: true });

/* Positive control. analyze() must report a nonzero statement count for a
 * program that plainly has statements, and must find the refusal in a
 * program that plainly has one. A census that reports "0 blockers" from an
 * inert analyzer is indistinguishable from a clean bill of health — this
 * project has already paid for that mistake once. */
function control() {
  const dir = join(OUT, "control");
  mkdirSync(dir, { recursive: true });
  const clean = join(APP, "__fb_census_clean.ts");
  const dirty = join(APP, "__fb_census_dirty.ts");
  writeFileSync(clean, "let n = 0\nfor (let i = 0; i < 5; i++) n += i\nconsole.log(n)\n");
  // `with` is not lowerable under any flag: a guaranteed nonzero blocker.
  writeFileSync(dirty, "const o: Record<string, number> = { a: 1 }\nconsole.log(eval('o.a'))\n");
  const a = analyze(clean, {});
  const b = analyze(dirty, {});
  rmSync(clean, { force: true });
  rmSync(dirty, { force: true });
  const nClean = a.coverage.stats?.statementsTotal ?? a.coverage.stats?.total ?? 0;
  const blockersDirty = (b.coverage.diagnostics ?? []).length + (b.coverage.unreached?.diagnostics ?? []).length;
  return {
    cleanStatements: nClean,
    cleanBlockers: (a.coverage.diagnostics ?? []).length,
    dirtyBlockers: blockersDirty,
    ok: nClean > 0 && (a.coverage.diagnostics ?? []).length === 0 && blockersDirty > 0,
  };
}

const ctl = control();
console.log(
  `control: ${ctl.ok ? "PASS" : "FAIL"} — clean ${ctl.cleanStatements} stmts / ${ctl.cleanBlockers} blockers, ` +
    `dirty ${ctl.dirtyBlockers} blockers`,
);
if (!ctl.ok) {
  console.error("census.mjs: CONTROL FAILED — the analyzer is not reporting; refusing to publish a census.");
  process.exit(3);
}

/* One entry per PROCESS. `analyze()` is driven by a long-lived tsgo
 * session and `setProvenanceSources` is process-global: seventeen entries
 * in one process share whatever the sixteenth left behind, and a crash on
 * one loses the other sixteen. The parent forks a child per entry and
 * merges; FB_CHILD=1 is the child. */
const IS_CHILD = process.env.FB_CHILD === "1";
if (!IS_CHILD) {
  const { spawnSync } = await import("node:child_process");
  const rows = [];
  for (const entry of ENTRIES) {
    if (ONLY.length > 0 && !ONLY.includes(entry)) continue;
    if (!existsSync(join(APP, BENCH, entry))) {
      rows.push({ entry, missing: true });
      continue;
    }
    process.stdout.write(`census ${entry} ... `);
    const childOut = join(OUT, `.child-${TAG}.json`);
    /* Delete it FIRST. A child that dies without writing would otherwise
     * leave the parent reading the PREVIOUS entry's row and filing it
     * under this entry's name — a crash that reports as a result. */
    rmSync(childOut, { force: true });
    const r = spawnSync(
      process.execPath,
      [new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
      {
        env: { ...process.env, FB_CHILD: "1", FB_ONLY: entry, FB_CHILD_OUT: childOut },
        encoding: "utf8",
        timeout: 3_600_000,
        maxBuffer: 1 << 28,
      },
    );
    let row = null;
    try {
      row = JSON.parse(readFileSync(childOut, "utf8"));
    } catch {
      row = { entry, error: `child exit ${r.status}: ${(r.stderr ?? "").split("\n").slice(-6).join(" | ")}`, sites: [] };
    }
    rows.push(row);
    console.log(
      row.error !== undefined
        ? `CHILD FAILED (${String(row.error).slice(0, 160)})`
        : `${row.statements ?? "?"} stmts (${row.staticPct ?? "n/a"}% static), ${row.reachedSites} reached + ${row.unreachedSites} unreached sites (${((row.wallMs ?? 0) / 1000).toFixed(1)}s)`,
    );
  }
  publish(rows);
  process.exit(0);
}

const rows = [];
for (const entry of ENTRIES) {
  if (ONLY.length > 0 && !ONLY.includes(entry)) continue;
  const abs = join(APP, BENCH, entry);
  if (!existsSync(abs)) {
    rows.push({ entry, missing: true });
    continue;
  }
  process.stdout.write(`census ${entry} ... `);
  const started = Date.now();
  let prov = null;
  try {
    if (USE_PROVENANCE) {
      prov = await resolveProvenanceSources(abs);
      setProvenanceSources(prov);
    } else {
      setProvenanceSources(null);
    }
  } catch (e) {
    console.log(`provenance FAILED: ${e?.message ?? e}`);
  }
  let cov = null;
  let err = null;
  try {
    cov = analyze(abs, {}).coverage;
  } catch (e) {
    err = `${e?.name ?? "Error"}: ${e?.message ?? String(e)}`;
  }
  const wallMs = Date.now() - started;
  if (cov === null) {
    rows.push({ entry, wallMs, error: err, sites: [] });
    console.log(`ANALYZE THREW (${err})`);
    continue;
  }
  const mk = (d, reached) => {
    const file = d.loc?.file ?? "?";
    const { line, source } = lineOf(file, d.loc?.start);
    return {
      code: d.code,
      message: d.message,
      file: file.replace(/\\/g, "/"),
      line,
      source,
      reached,
      owner: ownerOf(file),
    };
  };
  const sites = [
    ...(cov.diagnostics ?? []).map((d) => mk(d, true)),
    ...(cov.unreached?.diagnostics ?? []).map((d) => mk(d, false)),
  ];
  /* The whole-program numbers, computed exactly the way renderCoverage
   * computes the line `scriptc coverage` prints: reached statements PLUS
   * the unreached remainder the analysis lowered anyway. Taking only
   * `stats.statementsTotal` reports 0 for a module whose every statement
   * is inside an unreached function body — which is most of this suite. */
  const st = cov.stats ?? {};
  const un = cov.unreached?.stats ?? {};
  const statements = (st.statementsTotal ?? 0) + (un.statementsTotal ?? 0);
  const failed = (st.statementsFailed ?? 0) + (un.statementsFailed ?? 0);
  const island = (st.statementsIsland ?? 0) + (un.statementsIsland ?? 0);
  rows.push({
    entry,
    wallMs,
    statements,
    statementsStatic: statements - failed - island,
    staticPct: statements === 0 ? null : Math.floor(((statements - failed - island) / statements) * 100),
    statementsFailed: failed,
    statementsIsland: island,
    statementsReached: st.statementsTotal ?? 0,
    provenanceMapped: (prov?.packages ?? []).map((p) => `${p.name}@${p.version}`),
    provenanceNotes: prov?.notes ?? [],
    reachedSites: sites.filter((s) => s.reached).length,
    unreachedSites: sites.filter((s) => !s.reached).length,
    sites,
  });
  console.log(
    `${statements} stmts (${statements === 0 ? "n/a" : Math.floor(((statements - failed - island) / statements) * 100) + "% static"}), ${sites.filter((s) => s.reached).length} reached + ` +
      `${sites.filter((s) => !s.reached).length} unreached sites (${(wallMs / 1000).toFixed(1)}s)`,
  );
}

if (IS_CHILD) {
  writeFileSync(process.env.FB_CHILD_OUT, JSON.stringify(rows[0] ?? { entry: ONLY[0], error: "no row" }));
  process.exit(0);
}

/* ── ranking ───────────────────────────────────────────────────────────── */

/* A SITE is one (file,line,code,message). The same construct on the same
 * line reached from three entries is ONE site, not three: seventeen
 * entries share one 58-file closure, and counting per entry would multiply
 * every shared blocker by seventeen and rank the closure, not the code. */
function rank(rows, filter) {
  const seen = new Set();
  const byCause = new Map();
  for (const r of rows) {
    for (const s of r.sites ?? []) {
      if (!filter(s)) continue;
      const siteKey = `${s.file}:${s.line}:${s.code}:${s.message}`;
      if (seen.has(siteKey)) continue;
      seen.add(siteKey);
      const ck = `${s.code} :: ${s.message}`;
      let c = byCause.get(ck);
      if (c === undefined) {
        c = { key: ck, code: s.code, message: s.message, sites: 0, reached: 0, owners: new Map(), examples: [] };
        byCause.set(ck, c);
      }
      c.sites++;
      if (s.reached) c.reached++;
      c.owners.set(s.owner, (c.owners.get(s.owner) ?? 0) + 1);
      if (c.examples.length < 5) c.examples.push({ file: s.file, line: s.line, source: s.source });
    }
  }
  return [...byCause.values()]
    .map((c) => ({ ...c, owners: Object.fromEntries([...c.owners.entries()].sort((a, b) => b[1] - a[1])) }))
    .sort((a, b) => b.sites - a.sites || a.key.localeCompare(b.key));
}

function publish(rows) {
  const all = rank(rows, () => true);
  const owned = rank(rows, (s) => s.owner === "zapo-js");
  const rest = rank(rows, (s) => s.owner !== "zapo-js");
  const uniqueSites = (list) => list.reduce((a, c) => a + c.sites, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    tag: TAG,
    provenance: USE_PROVENANCE,
    app: APP,
    bench: BENCH,
    control: ctl,
    rows,
    ranking: { all, ownedByProv2: owned, everythingElse: rest },
    totals: { all: uniqueSites(all), ownedByProv2: uniqueSites(owned), everythingElse: uniqueSites(rest) },
  };
  writeFileSync(join(OUT, `census-${TAG}.json`), JSON.stringify(report, null, 2));

  const L = [];
  L.push(`# Blocker census — ${TAG} lane`);
  L.push("");
  L.push(`control: ${ctl.ok ? "PASS" : "FAIL"} · provenance ${USE_PROVENANCE ? "on" : "off"} · ${report.generatedAt}`);
  L.push("");
  L.push("| entry | statements | static | static % | island | failed | reached sites | unreached sites | wall |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of rows) {
    L.push(
      `| \`${r.entry}\` | ${r.statements ?? (r.error ? "THREW" : "—")} | ${r.statementsStatic ?? "—"} | ` +
        `${r.staticPct === null || r.staticPct === undefined ? "—" : r.staticPct + "%"} | ${r.statementsIsland ?? "—"} | ${r.statementsFailed ?? "—"} | ` +
        `${r.reachedSites ?? "—"} | ${r.unreachedSites ?? "—"} | ${((r.wallMs ?? 0) / 1000).toFixed(1)}s |`,
    );
  }
  L.push("");
  L.push(
    `## Ranked causes over UNIQUE sites — ${report.totals.all} sites, ${all.length} causes ` +
      `(\`zapo-js\` ${report.totals.ownedByProv2}, everything else ${report.totals.everythingElse})`,
  );
  const table = (list, title) => {
    L.push("");
    L.push(`### ${title}`);
    L.push("");
    L.push("| # | sites | reached | code | cause | top owner |");
    L.push("|---:|---:|---:|---|---|---|");
    list.forEach((c, i) => {
      const top = Object.entries(c.owners)[0];
      L.push(
        `| ${i + 1} | ${c.sites} | ${c.reached} | ${c.code} | ${c.message.replace(/\|/g, "\\|").slice(0, 200)} | ${top?.[0]} ${top?.[1]} |`,
      );
    });
  };
  table(rest, `Everything BESIDES the prov2-owned cause — ${report.totals.everythingElse} sites`);
  table(owned, `Owned by block/prov2 (zapo-js source) — ${report.totals.ownedByProv2} sites`);
  writeFileSync(join(OUT, `census-${TAG}.md`), L.join("\n") + "\n");
  console.log(`\nwrote census-${TAG}.json / census-${TAG}.md — ${report.totals.all} unique sites, ${all.length} causes`);
}
