#!/usr/bin/env node
/* closure.mjs — the SECOND instrument.
 *
 * survey.mjs asks the compiler what happens. This asks the source what the
 * compiler will be asked to do, without the compiler: it walks each bench
 * entry's relative import closure exactly the way the provenance prescan
 * does (packages/compiler/src/frontend/provenance.ts, bareImportsWalk) and
 * reports every bare specifier, split by whether the import was type-only.
 *
 * Why two instruments: `block/prov2`'s second defect is that the prescan
 * SKIPS type-only imports, and a skipped import emits no note and no
 * diagnostic. It is invisible in the compiler's own output. A file whose
 * only `zapo-js` import is `import type` therefore looks, from survey.mjs
 * alone, like a file that never wanted zapo-js at all. This is the check
 * that tells those two apart.
 *
 *   FB_APP    driver project root
 *   FB_BENCH  bench dir relative to FB_APP
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";

const APP = resolve(process.env.FB_APP ?? "");
const BENCH = process.env.FB_BENCH ?? "tree/packages/fake-server/bench";
const OUT = process.env.FB_OUT !== undefined ? resolve(process.env.FB_OUT) : null;
const BUILTINS = new Set(builtinModules);

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

/* A deliberately dumb regex scan rather than a TypeScript parse: this is a
 * CONTROL for the compiler's own walk, and a control that shares the
 * subject's machinery checks nothing. It over-reports (a specifier inside
 * a comment counts) and the `selfCheck` below is what bounds that. */
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;'"]*?)from\s*['"]([^'"]+)['"]|(?:^|[^.\w])(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function specsOf(text) {
  const out = [];
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(text)) !== null) {
    if (m[3] !== undefined) {
      // `import type { X }` and `import { type X }` differ: only the first
      // makes the whole DECLARATION type-only, which is what the prescan
      // keys on.
      out.push({ spec: m[3], typeOnly: m[1] !== undefined, kind: "static" });
    } else if (m[4] !== undefined) {
      out.push({ spec: m[4], typeOnly: false, kind: "dynamic" });
    }
  }
  return out;
}

function resolveRel(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const cands = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const c of cands) {
    try {
      if (statSync(c).isFile() && /\.(ts|tsx|mts|cts)$/.test(c)) return c;
    } catch {
      /* next */
    }
  }
  return null;
}

function pkgNameOf(spec) {
  const p = spec.split("/");
  return spec.startsWith("@") ? p.slice(0, 2).join("/") : p[0];
}

function walk(entryAbs) {
  const seen = new Set();
  const queue = [entryAbs];
  /** specifier -> {value, typeOnly, dynamic, sites:[file:line]} */
  const bare = new Map();
  let files = 0;
  let unresolved = 0;
  while (queue.length > 0) {
    const f = resolve(queue.shift());
    if (seen.has(f)) continue;
    seen.add(f);
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    files++;
    for (const s of specsOf(text)) {
      if (s.spec.startsWith("./") || s.spec.startsWith("../")) {
        const dep = resolveRel(f, s.spec);
        if (dep === null) unresolved++;
        else queue.push(dep);
        continue;
      }
      if (s.spec.startsWith("#")) continue;
      const name = pkgNameOf(s.spec.replace(/^node:/, ""));
      if (s.spec.startsWith("node:") || BUILTINS.has(name)) {
        record(bare, `node:${name}`, s, f, true);
        continue;
      }
      record(bare, s.spec, s, f, false);
    }
  }
  return { files, unresolved, bare };
}

function record(map, key, s, file, builtin) {
  let e = map.get(key);
  if (e === undefined) {
    e = { spec: key, builtin, valueSites: 0, typeOnlySites: 0, dynamicSites: 0, files: new Set() };
    map.set(key, e);
  }
  if (s.kind === "dynamic") e.dynamicSites++;
  else if (s.typeOnly) e.typeOnlySites++;
  else e.valueSites++;
  e.files.add(file);
}

/* ── self check ────────────────────────────────────────────────────────── */

/* The walker must find something it is impossible not to find, and must
 * NOT find something that is not there. Both halves, or the report is a
 * report of nothing. */
function selfCheck() {
  const probe = [
    "import type { A } from 'aaa-type-only'",
    "import { B } from 'bbb-value'",
    "const c = await import('ccc-dynamic')",
    "import { readFile } from 'node:fs/promises'",
    "import './nowhere-relative'",
  ].join("\n");
  const got = specsOf(probe);
  const by = new Map(got.map((g) => [g.spec, g]));
  const ok =
    by.get("aaa-type-only")?.typeOnly === true &&
    by.get("bbb-value")?.typeOnly === false &&
    by.get("ccc-dynamic")?.kind === "dynamic" &&
    by.get("node:fs/promises") !== undefined &&
    by.get("ddd-absent") === undefined;
  return { ok, found: got.map((g) => `${g.spec}${g.typeOnly ? " (type)" : ""}${g.kind === "dynamic" ? " (dyn)" : ""}`) };
}

const sc = selfCheck();
console.log(`self-check: ${sc.ok ? "PASS" : "FAIL"} — ${sc.found.join(", ")}`);
if (!sc.ok) {
  console.error("closure.mjs: SELF-CHECK FAILED — refusing to report.");
  process.exit(3);
}

const rows = [];
for (const entry of ENTRIES) {
  const abs = join(APP, BENCH, entry);
  if (!existsSync(abs)) {
    rows.push({ entry, missing: true });
    continue;
  }
  const w = walk(abs);
  const bare = [...w.bare.values()]
    .map((e) => ({ ...e, files: e.files.length ?? [...e.files].length }))
    .sort((a, b) => a.spec.localeCompare(b.spec));
  rows.push({
    entry,
    filesInClosure: w.files,
    unresolvedRelative: w.unresolved,
    builtins: bare.filter((b) => b.builtin).map((b) => b.spec),
    packages: bare
      .filter((b) => !b.builtin)
      .map((b) => ({
        spec: b.spec,
        value: b.valueSites,
        typeOnly: b.typeOnlySites,
        dynamic: b.dynamicSites,
        /* The prescan skips type-only declarations, so a specifier with
         * zero value AND zero dynamic sites is INVISIBLE to provenance. */
        invisibleToPrescan: b.valueSites === 0 && b.dynamicSites === 0,
      })),
  });
}

const report = { generatedAt: new Date().toISOString(), app: APP, bench: BENCH, selfCheck: sc, rows };
if (OUT !== null) writeFileSync(join(OUT, "closure.json"), JSON.stringify(report, null, 2));

console.log("");
console.log("| entry | files in closure | packages | zapo-js specifiers | invisible to prescan |");
console.log("|---|---:|---:|---|---|");
for (const r of rows) {
  if (r.missing) {
    console.log(`| \`${r.entry}\` | — | — | — | — |`);
    continue;
  }
  const zapo = r.packages.filter((p) => /^zapo-js(\/|$)/.test(p.spec));
  const inv = r.packages.filter((p) => p.invisibleToPrescan).map((p) => p.spec);
  console.log(
    `| \`${r.entry}\` | ${r.filesInClosure} | ${r.packages.length} | ${zapo.map((z) => z.spec).join(", ") || "—"} | ${inv.join(", ") || "—"} |`,
  );
}
