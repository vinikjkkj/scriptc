/* tally.mjs -- summarise one or more sites.mjs records.
 *
 * Every count here is a CALL SITE count: one entry per diagnostic the
 * compiler raised, never a distinct-message count. Distinct messages are
 * reported separately and labelled, because a previous brief quoted the
 * distinct-message number as if it were the site number.
 *
 * ROOTS vs CASCADE. SC2004 is the compiler's own cascade marker ("uses of
 * 'x' inherit the blocker on its declaration" -- diagnostic.ts
 * blockedBindingUseDiag). Every other code is a root. The two are never
 * netted into one total.
 *
 * Usage: node tally.mjs <file-or-dir> [...]
 *        node tally.mjs --detail <file.json>
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const args = process.argv.slice(2);
const detail = args[0] === "--detail";
const paths = detail ? args.slice(1) : args;

const files = [];
for (const p of paths) {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) if (f.endsWith(".json")) files.push(join(p, f));
  } else files.push(p);
}

// Fold the block-specific roots out of file paths so two blocks' numbers
// can be compared: the lab-app root and the provenance cache's 40-hex dir.
const fold = (s, cmap) => {
  const f = String(s).replace(/\\/g, "/");
  const m = /([0-9a-f]{40})\/(.*)$/.exec(f);
  if (m) return `${(cmap && cmap.get(m[1].slice(0, 12))) ?? "<prov " + m[1].slice(0, 8) + ">"}/${m[2]}`;
  return f.replace(/^.*\/(napp|app)\//, "<app>/").replace(/^.*\/node_modules\//, "<nm>/");
};

const CASCADE = new Set(["SC2004"]);

/* OWNER of a site. The objective asks for each package's status, and a site
 * inside zapo-js's own source is NOT the store package's blocker even though
 * it stops the store package's build. Attribution, kept separate from the
 * raw count, is the only way to answer both honestly. */
const owner = (file, commitMap) => {
  const f = String(file).replace(/\\/g, "/");
  const m40 = /([0-9a-f]{40})\/(.*)$/.exec(f);
  if (m40) {
    // Which attested checkout is this? provenanceNotes name the package for
    // each 12-hex commit prefix. Without that map, mongodb's own `src/` reads
    // as zapo-js's `src/` and the attribution is silently wrong.
    const tree = commitMap.get(m40[1].slice(0, 12)) ?? `tree:${m40[1].slice(0, 8)}`;
    const rest = m40[2];
    const sub = /^packages\/([^/]+)\//.exec(rest);
    // A monorepo checkout serves several packages. Name the sub-package when
    // the path is under packages/, else the tree's own root package.
    if (sub) return `${tree} :: packages/${sub[1]}`;
    return `${tree} :: ${rest.split("/")[0]}/`;
  }
  const mn = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(f);
  if (mn) return `npm-island:${mn[1]}`;
  // lane F: the package source copied out of the attested v1.8.2 checkout.
  const mp = /\/pkgsrcN?\/([^/]+)\//.exec(f);
  if (mp) return `pkgsrc/${mp[1]} (v1.8.2 source)`;
  if (/\/napp\//.test(f)) return "the driver";
  return "other:" + f.slice(-60);
};
const commitMapOf = (notes) => {
  const m = new Map();
  for (const n of notes ?? []) {
    const x = /^(?:note: )?(.+?)@([^ ]+) <- ([0-9a-f]{12})/.exec(n);
    if (x) m.set(x[3], `${x[1]}@${x[2]}`);
  }
  return m;
};

for (const f of files.sort()) {
  let r;
  try {
    r = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    console.log(`${basename(f)}  UNREADABLE ${e.message}`);
    continue;
  }
  const bySec = {};
  for (const s of r.sites) (bySec[s.section] ??= []).push(s);
  const blockers = bySec.blocker ?? [];
  const roots = blockers.filter((s) => !CASCADE.has(s.code));
  const casc = blockers.filter((s) => CASCADE.has(s.code));
  const st = r.stats ?? {};
  const un = r.unreachedStats ?? {};
  const unreached = bySec.unreached ?? [];

  // ISLANDED / PREFLIGHT-FAIL are states, not zeros.
  let state;
  if (r.crashed) state = "CRASHED";
  else if (r.preflightFailed) state = "PREFLIGHT-FAIL";
  else if ((st.statementsTotal ?? 0) === 0 && (st.statementsIsland ?? 0) > 0) state = "ISLANDED";
  else if ((st.statementsTotal ?? 0) === 0) state = "EMPTY-OR-ISLANDED";
  else state = "ANALYSED";

  console.log(
    `\n=== ${basename(f, ".json")}  [${state}]  ms=${r.elapsedMs}` +
      (r.crashed ? `  CRASHED=${r.crashed.message}` : ""),
  );
  console.log(
    `    stmts total=${st.statementsTotal ?? "n/a"} failed=${st.statementsFailed ?? "n/a"} ` +
      `island=${st.statementsIsland ?? "n/a"} fnsSkipped=${st.functionsSkipped ?? "n/a"}` +
      `   | unreached total=${un.statementsTotal ?? "n/a"} failed=${un.statementsFailed ?? "n/a"}`,
  );
  console.log(
    `    BLOCKER SITES=${blockers.length}  (roots=${roots.length}  cascade/SC2004=${casc.length})` +
      `   distinct messages=${new Set(blockers.map((s) => s.code + " " + s.message)).size}` +
      `   runtimeFence=${(bySec.runtimeFence ?? []).length}  advisory=${(bySec.advisory ?? []).length}` +
      `   unreached-sites=${unreached.length}`,
  );
  if (r.provenanceNotes) for (const n of r.provenanceNotes) console.log(`    prov: ${n}`);
  const cmap = commitMapOf(r.provenanceNotes);
  if (blockers.length > 0) {
    const byOwner = {};
    for (const s of blockers) {
      const o = owner(s.file, cmap);
      (byOwner[o] ??= { roots: 0, cascade: 0 })[CASCADE.has(s.code) ? "cascade" : "roots"]++;
    }
    console.log(`    -- BLOCKER SITES BY OWNER (whose source the site is in):`);
    for (const [o, v] of Object.entries(byOwner).sort((a, b) => b[1].roots + b[1].cascade - a[1].roots - a[1].cascade)) {
      console.log(`       ${String(v.roots + v.cascade).padStart(5)}  ${o}  (roots=${v.roots} cascade=${v.cascade})`);
    }
  }

  const tally = (arr, label) => {
    if (arr.length === 0) return;
    const byCode = {};
    for (const s of arr) (byCode[s.code] ??= []).push(s);
    console.log(`    -- ${label} by code (SITES):`);
    for (const [code, ss] of Object.entries(byCode).sort((a, b) => b[1].length - a[1].length)) {
      const byFile = {};
      for (const s of ss) byFile[fold(s.file, cmap)] = (byFile[fold(s.file, cmap)] ?? 0) + 1;
      const fileList = Object.entries(byFile)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}:${v}`);
      console.log(`       ${String(ss.length).padStart(5)} ${code}  files=${fileList.length}`);
      for (const fl of fileList.slice(0, detail ? 200 : 6)) console.log(`             ${fl}`);
      if (!detail && fileList.length > 6) console.log(`             ... ${fileList.length - 6} more files`);
      const msgs = {};
      for (const s of ss) msgs[s.message] = (msgs[s.message] ?? 0) + 1;
      for (const [m, n] of Object.entries(msgs).sort((a, b) => b[1] - a[1]).slice(0, detail ? 100 : 4)) {
        console.log(`             ${String(n).padStart(4)}x  ${m.slice(0, 150)}`);
      }
    }
  };
  tally(roots, "BLOCKER ROOTS");
  tally(casc, "BLOCKER CASCADE (SC2004)");
  if (detail) {
    tally(bySec.runtimeFence ?? [], "RUNTIME FENCES");
    tally(bySec.advisory ?? [], "ADVISORIES");
    tally(unreached, "UNREACHED");
  }
}
