import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, exeSuffix } from "./cc.js";
import { beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const BINS: Record<string, string> = {
  fast: join(testDir, "build", "test_round" + exeSuffix),
  libm: join(testDir, "build", "test_round_nofast" + exeSuffix),
};

// scr_floor/scr_trunc/scr_ceil are static inlines in scr_runtime.h with no
// library behind them, so each arm is ONE translation unit -- nothing to
// link, nothing to keep in step.
beforeAll(async () => {
  await mkdir(join(testDir, "build"), { recursive: true });
  for (const [arm, out] of Object.entries(BINS)) {
    await ccCompile([
      "-std=c11", "-O2", "-Wall", "-Wextra",
      ...(arm === "libm" ? ["-DSCR_NO_FASTARM"] : []),
      ...(process.platform === "linux" ? ["-D_GNU_SOURCE"] : []),
      "-I", join(testDir, "../src"),
      "-o", out,
      join(testDir, "test_round.c"),
      ...(process.platform === "linux" ? ["-lm"] : []),
    ]);
  }
}, 240_000);

// Both arms. The fast one is the real differential; the -DSCR_NO_FASTARM
// one routes all three to the library functions, which makes the sweep a
// tautology -- and that is the point: it proves the A/B switch reaches all
// three, and it proves the harness runs the SAME number of cases either
// way rather than quietly running a different (or empty) sweep.
test.each([
  ["fast arm (default)", "fast"],
  ["libm arm (-DSCR_NO_FASTARM)", "libm"],
])(
  "Math.floor/trunc/ceil answer the library functions BIT for bit -- %s",
  async (_name, arm) => {
    const { stderr } = await execFileAsync(BINS[arm]!, [], { maxBuffer: 1 << 22 });
    // The positive control must have fired: without that line the sweep
    // could have run zero cases and still printed "0/0 cases passed".
    expect(stderr).toContain("positive control armed");
    const m = /(\d+)\/(\d+) cases passed/.exec(stderr);
    expect(m, `no case count in:\n${stderr}`).not.toBeNull();
    const [, passed, total] = m!;
    expect(Number(total)).toBeGreaterThan(2_000_000);
    expect(passed).toBe(total);
  },
  180_000,
);
