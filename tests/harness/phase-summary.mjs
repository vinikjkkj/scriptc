/* Prints one line of compiled-program cache accounting for a CI job, from the
 * per-test JSONL that tests/harness/phase-collect.ts writes under
 * SCRIPTC_PHASE_LOG. `cc.hit` and `cc.miss` count binary-cache lookups; `cc`
 * is the wall time of every native compile+link stage that ran, so the
 * milliseconds a hit avoids are the mean `cc` time of the misses times the
 * hit count (an estimate: a miss also pays a link the hit does not). Run as
 * `node tests/harness/phase-summary.mjs` with SCRIPTC_PHASE_LOG set. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env["SCRIPTC_PHASE_LOG"];
let tests = 0;
let hits = 0;
let misses = 0;
let ccMs = 0;
let ccStages = 0;
if (dir !== undefined && dir !== "" && existsSync(dir)) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (line === "") continue;
      const rec = JSON.parse(line);
      tests += 1;
      hits += rec.n["cc.hit"] ?? 0;
      misses += rec.n["cc.miss"] ?? 0;
      ccMs += rec.ms["cc"] ?? 0;
      ccStages += rec.n["cc"] ?? 0;
    }
  }
}
const missMsEstimate = misses > 0 ? Math.round((ccMs / Math.max(ccStages, 1)) * hits) : 0;
console.log(
  `phase-log: tests=${tests} cc.hit=${hits} cc.miss=${misses} ` +
    `cc.stages=${ccStages} cc.ms=${Math.round(ccMs)} avoided-ms-estimate=${missMsEstimate}`,
);
