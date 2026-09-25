/* Per-test phase accounting for the commit gate.
 *
 * Loaded as a vitest setupFile only when SCRIPTC_PHASE_LOG names a
 * directory (vitest.config.ts reads the same variable); with it unset the
 * module is never imported and the compiler's tap stays unlistened, so a
 * normal gate runs the historical code path.
 *
 * One JSONL line per test, into a per-PROCESS file (vitest's default pool
 * is `forks`, and several workers append concurrently — a shared file would
 * interleave partial writes on Windows, where an O_APPEND write is not
 * atomic). Each line carries the test's wall time and the milliseconds the
 * tapped stages inside it accounted for. Those stages can overlap the wall
 * (differential.test.ts runs the Node oracle and the compile concurrently),
 * so shares are reported against the sum of stages, never against the wall.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import type { PhaseTap } from "../../packages/compiler/src/phase-tap.js";

const dir = process.env["SCRIPTC_PHASE_LOG"];
if (dir !== undefined && dir !== "") {
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${process.pid}.jsonl`);
  let ms: Record<string, number> = {};
  let n: Record<string, number> = {};
  const tap: PhaseTap = (name, dt) => {
    ms[name] = (ms[name] ?? 0) + dt;
    n[name] = (n[name] ?? 0) + 1;
  };
  (globalThis as { __scrPhaseTap?: PhaseTap }).__scrPhaseTap = tap;

  let t0 = 0;
  beforeEach(() => {
    ms = {};
    n = {};
    t0 = performance.now();
  });
  afterEach((ctx) => {
    const wall = performance.now() - t0;
    const rec = {
      file: ctx.task.file?.name ?? "?",
      name: ctx.task.name,
      wall: Math.round(wall * 1000) / 1000,
      state: ctx.task.result?.state ?? "?",
      ms,
      n,
    };
    try {
      appendFileSync(out, JSON.stringify(rec) + "\n");
    } catch {
      /* instrumentation is never a test failure */
    }
  });
}
