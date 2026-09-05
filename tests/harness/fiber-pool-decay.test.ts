/* THE FIBER-STACK POOL GIVES ITS HIGH-WATER MARK BACK.
 *
 * The pool (scr_async.c, SCR_FIBER_POOL, default 4096) keeps a finished
 * fiber's stack instead of deleting it, which is what removes the burst's
 * page-fault bill. The cap bounds how MANY idle stacks are kept; until the
 * decay landed, nothing bounded how LONG — scr_fiber_pool_teardown runs at
 * process exit, so one burst held the cap's worth of touched pages for the
 * life of the process. On a long-lived server that is the whole difference
 * between "climbs during a sync and comes back" and "climbs during a sync
 * and stays there". Measured on the probe in scr_async.c's own comment:
 * 4.75 MiB idle, 212 MiB at the burst, and then 37.42 MiB held flat with
 * the pool at 4096 against 15.00 MiB with the pool off.
 *
 * WHAT THIS FILE PINS IS THE MECHANISM, NOT THE MEGABYTES. RSS on this
 * host swings far too wide to assert on (the working-set trimmer moved an
 * identical arm 6.0-80.2 MiB across six runs), so the assertions are the
 * counter the decay keeps: how many stacks it freed, and how big the idle
 * list got. Both arms run the SAME BINARY and differ only in the env knob,
 * so a difference between them cannot be a difference in the code.
 *
 * THE ARMS, and why each is here:
 *   decay off (SCR_FIBER_POOL_DECAY_MS=0)  -- the pre-decay runtime, and
 *     the negative control: the trim must print NOTHING. A trim that ran
 *     and found nothing to free prints `freed=0`, so "no lines" and "no
 *     work" are distinguishable readings rather than the same zero.
 *   decay on                               -- must drain the pool.
 *   the pool must have FILLED first        -- the positive control. If the
 *     burst never loaded the pool, "the pool drained" is true for the
 *     wrong reason, and this suite has shipped that mistake before.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";
const src = join(repoRoot, "tests/fixtures/fiber-pool-decay/burst.ts");

/* A small cap keeps the run short and the drain complete: 256 halves to
 * nothing in 8 windows, and 200 chains x 7 live stacks each is 1,400
 * concurrent fibers, comfortably more than the cap. */
const CAP = 256;

interface Window {
  readonly freed: number;
  readonly idle: number;
  /* The window's low-water mark: how many entries sat idle through the
   * WHOLE window and are therefore provably surplus. This, not `idle`, is
   * the pool's high-water reading — by the time a window prints `idle` it
   * has already freed half of what it found. */
  readonly lo: number;
}

function parseWindows(stderr: string): Window[] {
  const out: Window[] = [];
  for (const line of stderr.split("\n")) {
    const m = /^\[fiberpool\] window freed=(\d+) idle=(\d+) lo=(\d+)/.exec(line.trim());
    if (m) out.push({ freed: Number(m[1]), idle: Number(m[2]), lo: Number(m[3]) });
  }
  return out;
}

async function runArm(bin: string, decayMs: number): Promise<{ stdout: string; windows: Window[] }> {
  const { stdout, stderr } = await execFileAsync(bin, [], {
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      SCR_FIBER_POOL: String(CAP),
      SCR_FIBER_POOL_DECAY_MS: String(decayMs),
      SCR_FIBER_POOL_STAT: "1",
      BURST_WIDTH: "200",
      BURST_DEPTH: "6",
      BURST_TAIL_MS: "1500",
    },
  });
  return { stdout: stdout.replace(/\r\n/g, "\n"), windows: parseWindows(stderr) };
}

describe("the fiber-stack pool decays back to its idle floor", () => {
  const key = createHash("sha256")
    .update(readFileSync(src))
    .update(sanitize ? "san" : "plain")
    .digest("hex")
    .slice(0, 16);
  const dir = join(cacheDir, `fiber-pool-decay-${key}`);
  let bin = "";

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    const result = await compile(src, {
      outPath: join(dir, exeName("burst")),
      outDir: dir,
      sanitize,
    });
    if (!result.ok) {
      throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    }
    bin = result.binaryPath;
  }, 300_000);

  test("decay off prints no windows at all (the negative control)", async () => {
    const { stdout, windows } = await runArm(bin, 0);
    expect(stdout).toBe("burst 200\ndone\n");
    expect(windows).toEqual([]);
  }, 180_000);

  test("decay on fills the pool and then drains it", async () => {
    const { stdout, windows } = await runArm(bin, 50);
    expect(stdout).toBe("burst 200\ndone\n");

    /* The positive control: the burst must actually have loaded the pool,
     * or a drained pool proves nothing. */
    const highWater = Math.max(...windows.map((w) => w.lo));
    expect(highWater).toBeGreaterThanOrEqual(CAP);

    /* And it must come back down. Halving per window from a full cap
     * reaches single digits well inside the 1.5 s tail. */
    const freedTotal = windows.reduce((a, w) => a + w.freed, 0);
    expect(freedTotal).toBeGreaterThanOrEqual(CAP / 2);
    expect(windows[windows.length - 1]!.idle).toBeLessThanOrEqual(CAP / 8);
  }, 180_000);
});
