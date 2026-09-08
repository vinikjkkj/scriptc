/* Map a census log's REFUSAL rows onto the nine causes of the refusal
 * inventory, so "what is behind the weakmap wall" is answered by cluster
 * rather than by reading 40 tab-separated lines.
 *
 * A census row is `SCRIPTC_LLVM_CENSUS<TAB>REFUSAL<TAB>count<TAB>kind<TAB>fn<TAB>loc`.
 * DOWNSTREAM rows are knock-on errors after a skipped statement — they are
 * counted separately here and must never be presented as tier gaps, which is
 * the same rule unsupported.ts applies when it writes them.
 *
 * Usage:  node tests/perf/llvmparity/census-classify.mjs <census.log> [--check]
 */
import fs from "node:fs";

/* The nine causes, in the order the inventory ranks them. `test` is the
 * predicate over a refusal's kind tag. */
const CLUSTERS = [
  { id: "1  WeakMap",              test: (k) => /^weakmap:/.test(k) },
  { id: "2a libCall wrtc",         test: (k) => /^libCall:wrtc\./.test(k) },
  { id: "2b libCall http2",        test: (k) => /^libCall:http2\./.test(k) },
  { id: "2c libCall stream ctor",  test: (k) => /^libCall:(readable|writable|duplex|transform|passthrough)\./.test(k) },
  { id: "2d libCall node:test",    test: (k) => /^libCall:test\./.test(k) },
  { id: "2e libCall other",        test: (k) => /^libCall:/.test(k) },
  { id: "3  dyn box/match/unbox",  test: (k) => /^(dyn-handle-tag|dynMatch|dynArm):/.test(k) },
  { id: "4  classDef allow-list",  test: (k) => /^classDef:/.test(k) },
  { id: "5  emitter listener arity", test: (k) => /^emitterListenerArity:/.test(k) },
  { id: "6  narrow type-kind gap", test: (k) => /^(jsonStringify|unionToStr|truthy|bin|toString|genResume|recordKeyGet|unionKeyGet):/.test(k) },
  { id: "7  derived from C tables", test: (k) => /^(rc|box|mapKey|global):/.test(k) },
  { id: "8  defensive / fenced",   test: (k) => /^(arrayElem|forOf|stmt|switch|unionDisc|optChain|optChainResult|callValue|caughtNarrow|intrinsic|logArg|censusDownstreamOnly)/.test(k) },
  { id: "9  deliberate refusal",   test: (k) => /^(truthy:union:(jsval|dyn)|unionEq:)/.test(k) },
  /* `type:<kind>` is ambiguous by construction — shapes.ts:472, emitter.ts:1572
   * and dyn.ts:2221/2908 all spell it. It is reported separately rather than
   * assigned to a cluster it might not belong to. */
  { id: "?  type:<kind> (ambiguous site)", test: (k) => /^type:/.test(k) },
];

function classify(kind) {
  for (const c of CLUSTERS) if (c.test(kind)) return c.id;
  return "UNCLASSIFIED — new cause, read the site";
}

if (process.argv.includes("--check")) {
  const cases = [
    ["weakmap:intrinsic", "1  WeakMap"],
    ["libCall:wrtc.newPeer", "2a libCall wrtc"],
    ["libCall:http2.connect", "2b libCall http2"],
    ["libCall:readable.initDyn", "2c libCall stream ctor"],
    ["libCall:fs.readChk", "2e libCall other"],
    ["classDef:%Foo", "4  classDef allow-list"],
    ["emitterListenerArity:5", "5  emitter listener arity"],
    ["unionEq:bigint", "9  deliberate refusal"],
    ["type:bigint", "?  type:<kind> (ambiguous site)"],
    ["somethingBrandNew:x", "UNCLASSIFIED — new cause, read the site"],
  ];
  let bad = 0;
  for (const [k, want] of cases) {
    const got = classify(k);
    const ok = got === want;
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"}  ${k.padEnd(26)} -> ${got}`);
  }
  /* ordering control: 2e must not swallow wrtc/http2/stream/test */
  console.log(`\n${bad ? bad + " FAILED" : "all checks passed"}`);
  process.exit(bad ? 1 : 0);
}

const file = process.argv[2];
if (!file) { console.error("usage: census-classify.mjs <census.log>"); process.exit(2); }
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

const refusals = [], downstream = [];
for (const l of lines) {
  const p = l.split("\t");
  if (p[0]?.trim() !== "SCRIPTC_LLVM_CENSUS" || p.length < 5) continue;
  const row = { count: Number(p[2]), kind: p[3], fn: p[4], loc: p[5] ?? "" };
  (p[1] === "REFUSAL" ? refusals : downstream).push(row);
}

if (refusals.length === 0 && downstream.length === 0) {
  console.log("no census rows in this log — n/a, NOT 0. Was SCRIPTC_LLVM_CENSUS=1 set?");
  process.exit(0);
}

const byCluster = new Map();
for (const r of refusals) {
  const c = classify(r.kind);
  if (!byCluster.has(c)) byCluster.set(c, { kinds: [], sites: 0 });
  const b = byCluster.get(c);
  b.kinds.push(r);
  b.sites += r.count;
}

console.log(`distinct tier refusals: ${refusals.length}   distinct downstream errors: ${downstream.length}`);
console.log(`total refusing sites:   ${refusals.reduce((a, r) => a + r.count, 0)}\n`);
console.log("cluster                          distinct  sites");
for (const [c, b] of [...byCluster.entries()].sort((a, b) => b[1].sites - a[1].sites))
  console.log(`${c.padEnd(32)} ${String(b.kinds.length).padStart(8)} ${String(b.sites).padStart(6)}`);

console.log("\n--- every distinct refusal, by cluster ---");
for (const [c, b] of [...byCluster.entries()].sort((a, b) => b[1].sites - a[1].sites)) {
  console.log(`\n${c}`);
  for (const r of b.kinds.sort((x, y) => y.count - x.count))
    console.log(`  ${String(r.count).padStart(5)}  ${r.kind.padEnd(44)} ${r.fn}  ${r.loc}`);
}
if (downstream.length) {
  console.log("\n--- downstream (knock-on after a skipped statement; NOT tier gaps) ---");
  for (const r of downstream.sort((x, y) => y.count - x.count).slice(0, 15))
    console.log(`  ${String(r.count).padStart(5)}  ${r.kind.slice(0, 110)}`);
}
