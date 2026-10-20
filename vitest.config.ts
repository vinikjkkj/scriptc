import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { BaseSequencer } from "vitest/node";
import { shardOf } from "./tests/harness/shard.ts";

// Compiled-binary + oracle caches for the test lanes (see cc.ts's cache block
// and tests/harness/README.md). Workers inherit SCRIPTC_CACHE_DIR from here;
// SCRIPTC_NO_CACHE=1 in the caller's environment bypasses every cache in both
// directions (no reads, no writes). Production CLI builds never see this —
// caching is opt-in via the env var, and only vitest sets it.
const cacheDir =
  process.env["SCRIPTC_CACHE_DIR"] ??
  fileURLToPath(new URL("./node_modules/.cache/scriptc-tests/cas", import.meta.url));

// Contention control for concurrent agents: SCRIPTC_TEST_WORKERS caps the vitest
// worker pool (the default — all cores — is unchanged when unset). Full-suite
// runs additionally queue behind an advisory lock; see suite-lock.mjs.
const workers = process.env["SCRIPTC_TEST_WORKERS"];

/* The corpus parts go FIRST.
 *
 * vitest's default sequencer orders by the previous run's recorded
 * duration, and falls back to FILE SIZE when it has no record — which is
 * every fresh checkout and every CI job. The corpus entry files under
 * tests/harness/corpus/ are four lines each and carry ~230 corpus programs
 * apiece, so by size they sort dead last: the pool would finish the cheap
 * files and then start its most expensive work with nothing left to
 * overlap it, and the split would buy nothing on exactly the runs that
 * need it most. Hoisting them is a stable partition of whatever order the
 * base sequencer produced, so the rest keeps its (duration-aware) order. */
class CorpusFirstSequencer extends BaseSequencer {
  // Default BaseSequencer.shard() hashes each matched file's path, SORTS the
  // whole list by that hash, and SLICES a contiguous window per CI shard
  // index. That is not a per-file assignment: adding or removing a single
  // spec file anywhere in the repo shifts every later file's position in
  // the sorted order by one, which can push an UNRELATED file across a
  // shard boundary into a different CI job. On 2026-10-20 this silently
  // relocated packages/compiler/test/ts7/resolver-parity.test.ts (a
  // pre-existing, Windows-only failure unrelated to the change in flight)
  // from shard 19/20 to shard 20/20 purely because
  // tests/harness/classd-rc-audit-probe.test.ts was added, flipping a
  // previously-green Windows job red and misattributing a 44-job-old defect
  // to the PR that happened to add a file earlier in hash order.
  //
  // Use the SAME stable per-key hash as SCRIPTC_TEST_SHARD's shardOf (see
  // shard.ts) instead: a file's shard membership then depends only on its
  // OWN path, never on how many other files exist or in what order. The two
  // uses of shardOf operate on disjoint key domains (full test-file paths
  // here vs. corpus case names there), so there is no cross-axis
  // correlation to salt apart (contrast partOf, which deliberately is
  // salted apart from shardOf because it shares shardOf's own key domain).
  async shard(files: Parameters<BaseSequencer["shard"]>[0]) {
    const { config } = this.ctx;
    const { index, count } = config.shard;
    const root = config.root.replace(/\\/g, "/");
    return files.filter((spec) => {
      const fullPath = resolvePath(root, spec.moduleId).replace(/\\/g, "/");
      const specPath = fullPath.slice(root.length);
      return shardOf(specPath, count) === index;
    });
  }

  async sort(files: Parameters<BaseSequencer["sort"]>[0]) {
    const sorted = await super.sort(files);
    const corpus = (f: (typeof sorted)[number]): boolean =>
      f.moduleId.replace(/\\/g, "/").includes("/tests/harness/corpus/");
    return [...sorted.filter(corpus), ...sorted.filter((f) => !corpus(f))];
  }
}

export default defineConfig({
  resolve: {
    alias: {
      // Tests run against compiler source directly — no build step needed.
      "@scriptc/compiler": fileURLToPath(
        new URL("./packages/compiler/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: [
      "tests/harness/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
    ],
    // Differential tests spawn clang + binaries; give them room. 300s is a
    // hang detector, not a performance bound: under a merge gate sharing
    // the box with lane compiles, a legitimately compile-heavy corpus
    // entry can starve past 120s (1751 timed out twice on 2026-07-20 while
    // passing in 3s isolated and uncached).
    testTimeout: 300_000,
    hookTimeout: 300_000,
    env: { SCRIPTC_CACHE_DIR: cacheDir },
    ...(workers !== undefined && workers !== ""
      ? { maxWorkers: Number(workers), minWorkers: 1 }
      : {}),
    globalSetup: ["./tests/harness/suite-lock.mjs"],
    sequence: { sequencer: CorpusFirstSequencer },
    // scratch-hooks is ALWAYS on: it is the in-run half of the scratch
    // bound (globalSetup's sweep can only reclaim between runs), and a
    // filtered run that cannot reclaim is how the tree fills while the
    // bound looks like it is working.
    // Gate-cost accounting, off unless asked: the collector installs the
    // compiler's phase tap and writes one JSONL row per test.
    setupFiles: [
      "./tests/harness/scratch-hooks.ts",
      ...(process.env["SCRIPTC_PHASE_LOG"] ? ["./tests/harness/phase-collect.ts"] : []),
    ],
  },
});
