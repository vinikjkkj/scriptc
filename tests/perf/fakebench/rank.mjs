#!/usr/bin/env node
/* rank.mjs — the final ranking, computed OFF the census JSON.
 *
 * Separate from census.mjs on purpose. The census is expensive (one tsgo
 * program per entry, an hour for three lanes) and the attribution rule is
 * the part most likely to be wrong: the first version of it bucketed a
 * site by the FILE it sits in, which puts every refusal inside zapo's own
 * source into the "owned by prov2" pile. That is backwards. Those sites
 * exist BECAUSE provenance mapped the package and compiled its source;
 * prov2's fix produces more of them, not fewer.
 *
 * What prov2 actually owns is the OPPOSITE shape: a `zapo-js` specifier
 * that did NOT map, which the compiler then refuses as an island —
 * "importing 'zapo-js' requires the embedded dynamic engine" (SC2013) and
 * its siblings. Measured directly: a two-line program importing
 * `zapo-js/transport` produces exactly two SC2013 sites and the note "no
 * source mapping for 'zapo-js/transport' (published target:
 * ./dist/esm/transport/index.js)".
 *
 * Re-running this over a new census (after prov2 lands) gives the delta.
 *
 *   node rank.mjs <census.json> [<baseline-census.json>]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/* Which PACKAGE a site's file belongs to, resolved from the file itself
 * rather than from a path pattern.
 *
 * The census's own ownerOf() bucketed anything under the provenance cache
 * as "zapo-js", and that was wrong in a way worth naming: the cache holds
 * FOUR source trees, not one. `--provenance-sources` is transitive, and
 * mongodb publishes with a provenance attestation, so installing the
 * mongo driver pulled mongodb's entire TypeScript source into the program
 * — 696 raw diagnostics from mongo_logger.ts alone. Attributing those to
 * zapo would have made zapo's own source look three times worse than it
 * is. This walks up to the nearest package.json and takes its name. */
const pkgNameCache = new Map();
function packageOf(file) {
  let dir = dirname(file.split("\\").join("/"));
  for (let i = 0; i < 12; i++) {
    if (pkgNameCache.has(dir)) return pkgNameCache.get(dir);
    const pj = join(dir, "package.json");
    if (existsSync(pj)) {
      let name = null;
      try {
        name = JSON.parse(readFileSync(pj, "utf8")).name ?? null;
      } catch {
        name = null;
      }
      if (name !== null) {
        pkgNameCache.set(dir, name);
        return name;
      }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return "(unknown)";
}

const [file, baseFile] = process.argv.slice(2);
if (file === undefined) {
  console.error("usage: rank.mjs <census.json> [<baseline.json>]");
  process.exit(2);
}
const report = JSON.parse(readFileSync(file, "utf8"));

/* ── attribution ───────────────────────────────────────────────────────── */

/* The island refusal for a package the provenance pipeline could not map
 * to source. This is the prov2-owned shape, and the ONLY one: the fix
 * makes the specifier map, and a mapped specifier compiles as a program
 * module instead of refusing. */
const ISLAND_CODES = new Set(["SC2013", "SC1010"]);
/* A `zapo-js` SUBPATH specifier, spelled the way the compiler spells it in
 * a message. The root specifier is not in this set: `zapo-js` alone maps
 * today, through mapEntryToSource's `subpath === "."` fallback to
 * src/index.ts. Only the subpaths fail — every one of them resolves to a
 * `dist/esm/...` target, and the dist-stripping regex handles `dist/` but
 * not `dist/esm/`. */
const ZAPO_SUBPATH = /'zapo-js\/[\w.-]+'/;
const ZAPO_ANY = /'zapo-js(\/[\w.-]+)?'|the 'zapo-js' package/;

function bucketOf(site) {
  /* prov2 owns a site when the reason it exists is that a `zapo-js`
   * specifier never became a source module. That has TWO surface forms,
   * and the first version of this rule saw only the second:
   *
   *  1. `Cannot find module 'zapo-js/store'` (SC0001). An unmapped
   *     specifier never becomes a tsconfig "paths" entry, so every file in
   *     the provenance-mapped source trees that imports it fails to
   *     resolve it — 77 sites for `zapo-js/store` alone. These are
   *     PREFLIGHT errors and look like ordinary TypeScript noise.
   *  2. `importing 'zapo-js' requires the embedded dynamic engine`
   *     (SC2013 / SC1010). The unmapped specifier falls back to the island
   *     and the static lane refuses the island.
   *
   * Both disappear when the specifier maps. Verified directly: a two-line
   * program importing `zapo-js/transport` produces exactly the note "no
   * source mapping for 'zapo-js/transport' (published target:
   * ./dist/esm/transport/index.js)" and two SC2013 sites. */
  if (site.code === "SC0001" && /Cannot find module/.test(site.message) && ZAPO_SUBPATH.test(site.message)) {
    return "prov2: unmapped zapo-js";
  }
  if (ISLAND_CODES.has(site.code) && ZAPO_ANY.test(site.message)) return "prov2: unmapped zapo-js";
  if (ISLAND_CODES.has(site.code)) return "island: another package";
  if (site.code === "SC0001") return "preflight: TypeScript";
  if (site.code === "SC0004") return "preflight: tsgo panic";
  if (/^SC9/.test(site.code)) return "ICE";
  if (/^SC2/.test(site.code)) return "type rules";
  if (/^SC1/.test(site.code)) return "TypeScript not yet";
  return `other (${site.code})`;
}

/* One SITE is one (file,line,code,message). Seventeen entries share one
 * ~58-file import closure: counting per entry multiplies every shared
 * blocker by seventeen and ranks the closure instead of the code. */
function collect(rows) {
  const seen = new Map();
  for (const r of rows) {
    for (const s of r.sites ?? []) {
      const k = `${s.file}:${s.line}:${s.code}:${s.message}`;
      if (!seen.has(k)) seen.set(k, { ...s, bucket: bucketOf(s), owner: packageOf(s.file), entries: new Set() });
      seen.get(k).entries.add(r.entry);
    }
  }
  return [...seen.values()];
}

const sites = collect(report.rows ?? []);

function group(list, keyOf) {
  const m = new Map();
  for (const s of list) {
    const k = keyOf(s);
    let e = m.get(k);
    if (e === undefined) {
      e = { key: k, sites: 0, entries: new Set(), files: new Set(), owners: new Map(), examples: [], code: s.code, message: s.message, bucket: s.bucket };
      m.set(k, e);
    }
    e.sites++;
    for (const x of s.entries) e.entries.add(x);
    e.files.add(s.file);
    e.owners.set(s.owner, (e.owners.get(s.owner) ?? 0) + 1);
    if (e.examples.length < 5) e.examples.push(`${s.file.replace(/^.*[/\\](?=(?:[^/\\]*[/\\]){0,2}[^/\\]*$)/, "")}:${s.line}  ${s.source ?? ""}`);
  }
  return [...m.values()].sort((a, b) => b.sites - a.sites || a.key.localeCompare(b.key));
}

/* ── fix families ──────────────────────────────────────────────────────
 *
 * The cause table below is 249 rows long and its biggest non-prov2 row is
 * 21 sites. Read alone it says "there is no leverage here", which is
 * false: the rows are not independent. Six of them are the same missing
 * `mongo_logger.ts` type narrowing seen from six call sites, and 47 of
 * them are one refusal propagating through `SC2004: uses of X inherit the
 * blocker on its declaration`.
 *
 * A FAMILY is a claim about what ONE change would remove. It is a
 * judgement, not a measurement, so it is reported beside the raw cause
 * table rather than instead of it — and every family is falsifiable by
 * re-running this after the corresponding fix. */
const APP_INSTALLED = /'(mongodb|pg|mysql2(\/promise)?|ioredis|better-sqlite3|mongodb-client-encryption|bson)'/;
function familyOf(s) {
  if (s.bucket === "prov2: unmapped zapo-js") return "A. prov2: no zapo-js subpath maps (dist/esm) + type-only imports skip the prescan";
  if (s.code === "SC2004") return "B. cascade: a blocked declaration poisons every use of it";
  if (s.code === "SC0001" && /Cannot find module/.test(s.message) && APP_INSTALLED.test(s.message)) {
    return "C. a provenance-mapped source tree cannot resolve its own external deps";
  }
  const zapoOwned =
    s.owner === "@zapo-js/fake-server" || s.owner === "zapo-js" || s.owner.startsWith("@zapo-js/store");
  if (s.code === "SC0001" && !zapoOwned) {
    return "D. third-party source typechecked under the DRIVER's tsconfig";
  }
  if (s.code === "SC0001") return "E. preflight: the bench's own TypeScript under scriptc's forced options";
  if (s.code === "SC2020" || s.code === "SC1090") return "F. a named standard-library / Node surface with no lowering yet";
  if (s.code === "SC2011" || s.code === "SC2009" || /^SC2/.test(s.code)) return "G. a value whose TYPE has no static representation";
  if (s.code === "SC1010") return "H. an unsupported module or an uninstalled package";
  return `I. other (${s.code})`;
}
for (const s of sites) s.family = familyOf(s);

const byBucket = group(sites, (s) => s.bucket);
const byCause = group(sites, (s) => `${s.code} :: ${s.message}`);
const owned = byCause.filter((c) => c.bucket === "prov2: unmapped zapo-js");
const rest = byCause.filter((c) => c.bucket !== "prov2: unmapped zapo-js");
const total = sites.length;
const ownedSites = owned.reduce((a, c) => a + c.sites, 0);

/* ── output ────────────────────────────────────────────────────────────── */

const L = [];
L.push(`# Ranked blockers — ${basename(file)}`);
L.push("");
L.push(`${total} unique sites, ${byCause.length} distinct causes, over ${(report.rows ?? []).length} entries.`);
L.push("");
L.push(`\`block/prov2\` owns **${ownedSites}** of them (${((ownedSites / total) * 100).toFixed(1)}%). Everything else: **${total - ownedSites}**.`);
L.push("");
L.push("## By bucket");
L.push("");
L.push("| bucket | sites | causes | entries |");
L.push("|---|---:|---:|---:|");
for (const b of byBucket) {
  const causes = byCause.filter((c) => c.bucket === b.key).length;
  L.push(`| ${b.key} | ${b.sites} | ${causes} | ${b.entries.size} |`);
}

L.push("");
L.push("## By fix family (a judgement about what ONE change removes)");
L.push("");
L.push("| family | sites | causes | share |");
L.push("|---|---:|---:|---:|");
for (const f of group(sites, (s) => s.family)) {
  const causes = new Set(sites.filter((s) => s.family === f.key).map((s) => `${s.code}::${s.message}`)).size;
  L.push(`| ${f.key} | ${f.sites} | ${causes} | ${((f.sites / total) * 100).toFixed(1)}% |`);
}

L.push("");
L.push("## By owning tree");
L.push("");
L.push("| tree | sites | causes | note |");
L.push("|---|---:|---:|---|");
const byOwner = group(sites, (s) => s.owner);
for (const o of byOwner) {
  const causes = new Set(sites.filter((s) => s.owner === o.key).map((s) => `${s.code}::${s.message}`)).size;
  L.push(`| ${o.key} | ${o.sites} | ${causes} | |`);
}

const table = (list, title, limit) => {
  L.push("");
  L.push(`## ${title}`);
  L.push("");
  L.push("| # | sites | entries | code | cause | example |");
  L.push("|---:|---:|---:|---|---|---|");
  list.slice(0, limit ?? list.length).forEach((c, i) => {
    L.push(
      `| ${i + 1} | ${c.sites} | ${c.entries.size} | ${c.code} | ${c.message.replace(/\|/g, "\\|").slice(0, 190)} | ${(c.examples[0] ?? "").replace(/\|/g, "\\|").slice(0, 90)} |`,
    );
  });
};
table(rest, `Everything BESIDES the prov2-owned cause — ${total - ownedSites} sites, ${rest.length} causes`, 40);
table(owned, `Owned by block/prov2 — ${ownedSites} sites, ${owned.length} causes`);

if (baseFile !== undefined) {
  const base = JSON.parse(readFileSync(baseFile, "utf8"));
  const baseSites = new Set(collect(base.rows ?? []).map((s) => `${s.file}:${s.line}:${s.code}:${s.message}`));
  const nowSites = new Set(sites.map((s) => `${s.file}:${s.line}:${s.code}:${s.message}`));
  const gone = [...baseSites].filter((k) => !nowSites.has(k)).length;
  const added = [...nowSites].filter((k) => !baseSites.has(k)).length;
  L.push("");
  L.push(`## Delta against ${basename(baseFile)}`);
  L.push("");
  L.push(`| in both | only in baseline (fixed) | only now (new) |`);
  L.push(`|---:|---:|---:|`);
  L.push(`| ${baseSites.size - gone} | ${gone} | ${added} |`);
  if (gone === 0 && added === 0) L.push("");
  if (gone === 0 && added === 0) L.push("**NO DIFFERENCE** — site for site identical.");
}

const out = file.replace(/\.json$/, "") + ".ranked.md";
writeFileSync(out, L.join("\n") + "\n");
console.log(L.slice(0, 40).join("\n"));
console.log(`\nwrote ${out}`);
