/* The coverage sweep over ONE PART of the flat corpus.
 *
 * It lived as a single test inside coverage.test.ts, and once the two
 * differentials were split it became the gate's longest file on its own:
 * 764 s of a 1,007 s wall, one analyze() per corpus program, all inside one
 * vitest worker. The sweep is per-program and order-independent, so it
 * splits the same way the differentials do — the parts partition the flat
 * corpus exactly (shard.ts's partOf), so the set still analyses every
 * program exactly once, and corpus-parts.test.ts guards the entry files.
 *
 * Not a *.test.ts: the parts under tests/harness/corpus/ are what vitest
 * collects.
 */
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { analyze } from "@scriptc/compiler";
import { corpusSlice, partSuffix, shardSuffix } from "./shard.js";

const repoRoot = join(import.meta.dirname, "../..");

export function defineCoverageCorpusSweep(part = 1, parts = 1): void {
  describe("coverage corpus sweep", () => {
  test(`every corpus program is 100% static (corpus and coverage agree${shardSuffix()}${partSuffix(part, parts)})`, async () => {
    // The differential corpus compiles by definition; coverage must agree.
    // `// @dynamic` programs compile under --dynamic, so analyze them that way.
    // The sweep runs minutes on slow machines and each analyze() blocks the
    // worker thread — without the periodic yield, vitest's worker RPC starves
    // ("Timeout calling onTaskUpdate") even while every check passes, and the
    // default per-test timeout is far too small for a whole-corpus analysis.
    let n = 0;
    const flatEntries = corpusSlice(
        ["ts", "js", "mjs", "cjs"].flatMap((ext) =>
          globSync(join(repoRoot, `tests/corpus/*.${ext}`)),
        ).sort(),
        (file) => file.slice(repoRoot.length + 1),
        part,
        parts,
      );
    for (const file of flatEntries) {
      const firstLine = readFileSync(file, "utf8").split("\n", 1)[0] ?? "";
      // `// @deferred-fences: N` on the first line: a JS program that
      // DELIBERATELY carries N runtime-fence statements on untaken paths
      // (the deferred-fence corpus) — it still passes the differential
      // oracle because the fences never execute.
      const deferred = /^\/\/ @deferred-fences:\s*(\d+)\s*$/.exec(firstLine);
      const { coverage } = analyze(file, { dynamic: /^\/\/ @dynamic\s*$/.test(firstLine) });
      expect.soft(coverage.diagnostics, file).toEqual([]);
      // …and the IR the analysis lowered must VALIDATE. Until analyze() ran
      // validateModule, a program whose lowering succeeded and whose module
      // the validator rejects was graded "fully static" here while `scriptc
      // build` on the same file printed SC9001 — a green verdict a build
      // contradicts, and this suite is a merge gate. The gap was structural,
      // not one shape: none of validate.ts's 487 err() sites could reach a
      // coverage report at all. Ten of a hundred mechanical laundering
      // mutations (a cast spelling a record over a value that is not one)
      // reached it, across four validator sites and three receiver kinds.
      expect.soft(coverage.ice ?? [], file).toEqual([]);
      expect.soft(coverage.stats.statementsFailed, file).toBe(deferred ? Number(deferred[1]) : 0);
      if (++n % 10 === 0) await new Promise((r) => setImmediate(r));
    }
    // 1617 corpus files at ~370 ms each. The old 600 s budget was not a
    // correctness bound and it stopped being a time bound too: this test
    // timed out at 600,461 ms with ZERO failing assertions, so the gate
    // reported red for a sweep that had passed every check it ran. Sized
    // to the work rather than to how long it used to take.
  }, 2_400_000);

  });
}
