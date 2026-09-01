/* What does shipping scriptc-wrtc.d.ts cost PER PROGRAM?
 *
 * coverage.test.ts calls analyze() once per corpus file, 600-plus of them,
 * against a hardcoded 600 s timeout. A sibling block measured that test at
 * 578 s UNCONTENDED, so the margin is about 22 s. This block added a new
 * ambient declaration file to every program's roots, which every one of
 * those analyze() calls now parses and checks. Roughly 230 lines times 600
 * programs is exactly the shape of thing that could eat a 22 s margin, and
 * "it timed out under a concurrent gate" is not evidence either way.
 *
 * So: time the SAME analyze() loop the test runs, over a fixed sample, and
 * compare the tree with the ambient root against the tree without it. Same
 * host, same revision, back to back — not against a number recorded on
 * another revision on another day.
 *
 * Usage:  node ambient-cost.mjs <label> <count>
 * Writes  G:/blocks/wrtc-tmp/ambient-cost-<label>.json
 */

import { globSync } from "node:fs";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const label = process.argv[2] ?? "unlabelled";
const count = Number(process.argv[3] ?? "60");

const repoRoot = "G:/blocks/wrtc";
/* Import the built compiler by PATH: this script lives outside the
 * worktree, so a bare specifier resolves against the lab directory and
 * finds nothing. dist/index.js's own imports still resolve from inside
 * the worktree, which is what we want. */
const { analyze } = await import("file:///G:/blocks/wrtc/packages/compiler/dist/index.js");

/* The same selection rule the test uses -- sorted, so the sample is the
 * same set of files in the same order on both sides of the comparison. */
const files = ["ts", "js", "mjs", "cjs"]
  .flatMap((ext) => globSync(join(repoRoot, `tests/corpus/*.${ext}`)))
  .sort()
  .slice(0, count);

/* One warm-up that is NOT timed: the first analyze() pays for module
 * loading and the lib snapshot, and folding that into either side would
 * flatter whichever ran second. */
if (files.length > 0) {
  const first = files[0];
  const dyn = /^\/\/ @dynamic\s*$/.test(readFileSync(first, "utf8").split("\n", 1)[0] ?? "");
  analyze(first, { dynamic: dyn });
}

const per = [];
const t0 = performance.now();
for (const file of files) {
  const firstLine = readFileSync(file, "utf8").split("\n", 1)[0] ?? "";
  const dynamic = /^\/\/ @dynamic\s*$/.test(firstLine);
  const a = performance.now();
  analyze(file, { dynamic });
  per.push(performance.now() - a);
}
const total = performance.now() - t0;

per.sort((x, y) => x - y);
const median = per[Math.floor(per.length / 2)] ?? 0;
const out = {
  label,
  files: files.length,
  totalMs: Math.round(total),
  meanMs: Math.round((total / files.length) * 100) / 100,
  medianMs: Math.round(median * 100) / 100,
  minMs: Math.round((per[0] ?? 0) * 100) / 100,
  maxMs: Math.round((per[per.length - 1] ?? 0) * 100) / 100,
};
writeFileSync(`G:/blocks/wrtc-tmp/ambient-cost-${label}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
