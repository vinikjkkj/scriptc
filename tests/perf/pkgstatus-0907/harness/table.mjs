/* table.mjs -- build the status table from the two lanes' own artefacts, so no
 * number in the document is hand-transcribed.
 *
 *   lane A  build1.sh logs in queueA.log   -> "does it reach a binary"
 *   lane B  sites/<name>.json              -> site counts, roots vs cascade
 *
 * Rules this script enforces so a false zero cannot reach the table:
 *   * a build that exited non-zero has NO fence count: the cell reads n/a.
 *   * a record whose entry never crossed preflight, or that analysed zero
 *     statements, is a STATE (PREFLIGHT-FAIL / ISLANDED), never a 0.
 *   * every count is a SITE count. Distinct-message counts are a separate
 *     column and are labelled as such.
 */
import { readFileSync, existsSync } from "node:fs";

const LAB = `${process.env.BLOCKS_ROOT ?? "<blocks>"}/pkgstatus3-lab`;
const NAMES = process.argv.slice(2);
const CASCADE = new Set(["SC2004"]);

// Build results live in whichever queue ran them. Reading only queueA.log made
// every source-lane row report "not run" for its build columns -- an absence
// printed where a measurement existed.
const LOGS = ["queueA.log", "queueE.log", "queueF.log", "queueG.log", "queueH.log", "early-sqlite.log"];
const laneA = LOGS.flatMap((f) => {
  try {
    return readFileSync(`${LAB}/${f}`, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
});
function buildOf(name) {
  // The LAST run of a name, not the first: `src-media-utils` was attempted once
  // from pkgsrc/ (whose entry had been moved to pkgsrcN/ for the lib fix, so it
  // failed on a missing file) and once properly from pkgsrcN/. Taking the first
  // would report the harness's own accident as the package's result.
  let i = -1;
  for (let k = 0; k < laneA.length; k++) if (laneA[k].startsWith(`### ${name}  src=`)) i = k;
  if (i < 0) return null;
  // The closing line must NAME this program. Matching any `### DONE` reached
  // across a still-running build into the next log and reported another
  // program's binary as this one's -- a 677,888-byte "yes" that was hello.exe.
  const j = laneA.findIndex((l, k) => k > i && l.startsWith(`### DONE ${name} `));
  // Anything after the next program's header belongs to that program.
  const nextHdr = laneA.findIndex((l, k) => k > i && /^### \S+  src=/.test(l));
  if (j < 0) {
    const end = nextHdr < 0 ? laneA.length : nextHdr;
    return { done: false, running: true, prov: laneA.slice(i, end).filter((l) => /^\d+:provenance:/.test(l)).map((l) => l.replace(/^\d+:provenance: /, "")), codes: {} };
  }
  const blk = laneA.slice(i, j + 1);
  const g = (re) => {
    for (const l of blk) {
      const m = re.exec(l);
      if (m) return m[1];
    }
    return null;
  };
  const codes = {};
  for (const l of blk) {
    const m = /^\s*(\d+) LOG-CODE\s+(SC\d{4})/.exec(l);
    if (m) codes[m[2]] = Number(m[1]);
  }
  return {
    done: j >= 0,
    rc: g(/^BUILD rc=(\d+)/),
    secs: g(/^BUILD rc=\d+\s+(\d+)s/),
    logBytes: g(/log=(\d+)B/),
    logSites: g(/^LOG-SITES total=(\d+)/),
    compilerLine: g(/^\d+:(\d+ errors?\.)$/),
    bytes: g(/^BINARY bytes=(\d+)/),
    runExit: g(/^RUN exit=(\d+)/),
    oracle: g(/^ORACLE: (MATCH|DIFF)/),
    fence: /FENCES: no \.c TU/.test(blk.join("\n")) ? "n/a (LLVM lane keeps no C TU)" : g(/^FENCE-SITES total=(\d+)/),
    codes,
    prov: blk.filter((l) => /^\d+:provenance:/.test(l)).map((l) => l.replace(/^\d+:provenance: /, "")),
  };
}

/* The specifier each driver imports its SUBJECT through. If a provenance note
 * says that specifier took the island path, the record is UNMEASURED: the
 * sites it carries are the island boundary's, not the package's. Reporting
 * such a record as a small non-zero number is the exact error the objective
 * calls out, so the state must say so. */
const SUBJECT = {
  "store-memory": "zapo-js", "store-sqlite": "@zapo-js/store-sqlite",
  "store-mongo": "@zapo-js/store-mongo", "store-mysql": "@zapo-js/store-mysql",
  "store-postgres": "@zapo-js/store-postgres", "store-redis": "@zapo-js/store-redis",
  "media-utils": "@zapo-js/media-utils", "wam": "@zapo-js/wam", "voip": "@zapo-js/voip",
  "src-media-utils": null, "src-voip": null, "src-wam": null,
};

function sitesOf(name) {
  const p = `${LAB}/sites/${name}.json`;
  if (!existsSync(p)) return null;
  const r = JSON.parse(readFileSync(p, "utf8"));
  const b = r.sites.filter((s) => s.section === "blocker");
  const subj = SUBJECT[name];
  const islanded = subj !== null && subj !== undefined &&
    (r.provenanceNotes ?? []).some((n) => n.includes(subj + "@") && /island path used/.test(n));
  return {
    state: r.crashed ? "CRASHED" : islanded ? "**ISLANDED — UNMEASURED**" : r.preflightFailed ? "PREFLIGHT-FAIL"
      : (r.stats?.statementsTotal ?? 0) === 0 ? ((r.stats?.statementsIsland ?? 0) > 0 ? "ISLANDED" : "ZERO-STATEMENTS") : "ANALYSED",
    stmts: r.stats?.statementsTotal, failed: r.stats?.statementsFailed, island: r.stats?.statementsIsland,
    unStmts: r.unreachedStats?.statementsTotal, unFailed: r.unreachedStats?.statementsFailed,
    blockers: b.length,
    roots: b.filter((s) => !CASCADE.has(s.code)).length,
    cascade: b.filter((s) => CASCADE.has(s.code)).length,
    distinct: new Set(b.map((s) => s.code + " " + s.message)).size,
    fences: r.sites.filter((s) => s.section === "runtimeFence").length,
    advisories: r.sites.filter((s) => s.section === "advisory").length,
    unreached: r.sites.filter((s) => s.section === "unreached").length,
    notes: r.provenanceNotes ?? [],
    ms: r.elapsedMs,
  };
}

console.log("| package (driver) | binary? | bytes | oracle | build error SITES | compiler's own line | analyse state | stmts reached / failed | blocker SITES | roots | cascade SC2004 | distinct msgs | runtime fences | advisories | unreached SITES |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const n of NAMES) {
  const a = buildOf(n), s = sitesOf(n);
  const cell = (v, missing = "not run") => (v === null || v === undefined ? missing : v);
  console.log(
    `| \`${n}\` | ${a ? (a.running ? "*build running*" : a.rc === "0" ? "**yes**" : "**no**") : "not run"} ` +
      `| ${a && a.rc === "0" ? Number(a.bytes).toLocaleString("en-US") : "n/a"} ` +
      `| ${a && a.rc === "0" ? (a.oracle ?? "?") : "n/a"} ` +
      `| ${a ? cell(a.logSites) : "not run"} ` +
      `| ${a ? cell(a.compilerLine, a.rc === "0" ? "(none - 0 errors)" : "?") : "not run"} ` +
      `| ${s ? s.state : "not run"} ` +
      `| ${s ? `${s.stmts} / ${s.failed}` : "not run"} ` +
      // An islanded record's site counts are the ISLAND BOUNDARY's, not the
      // package's. Printing them in the package's columns is how a package with
      // no measurement ends up looking like the cleanest one in the table.
      (s && s.state.includes("ISLANDED")
        ? `| n/a — island (${s.blockers} island-boundary sites) | n/a | n/a | n/a | n/a | n/a | n/a |`
        : `| ${s ? s.blockers : "not run"} | ${s ? s.roots : "-"} | ${s ? s.cascade : "-"} | ${s ? s.distinct : "-"} ` +
          `| ${s ? s.fences : "-"} | ${s ? s.advisories : "-"} | ${s ? s.unreached : "-"} |`),
  );
}
console.log("\n### provenance resolution, per driver (the compiler's own notes)\n");
for (const n of NAMES) {
  const a = buildOf(n), s = sitesOf(n);
  const notes = a?.prov?.length ? a.prov : (s?.notes ?? []);
  console.log(`**${n}**`);
  if (notes.length === 0) console.log("  (no provenance notes recorded)");
  for (const x of notes) console.log(`  - ${x}`);
  console.log("");
}
