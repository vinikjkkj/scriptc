/* THE IDLE SEAM ASKS THE OS FOR ITS PAGES BACK — AND MOSTLY DOES NOT GET
 * THEM.
 *
 * scr_async.c's sleep seam now runs a heap trim (HeapCompact, then
 * HeapSetInformation/HeapOptimizeResources) once per SCR_HEAP_TRIM_MS. The
 * measured verdict is in that file's comment and it is a near-null: on
 * this toolchain the Win32 heap already decommits on free(), and what it
 * keeps it keeps because LIVE blocks pin the segments, which no trim can
 * move. 1.5-1.8% of a fragmented 136-165 MiB comes back, in 0.04-0.08 ms.
 *
 * SO THIS FILE PINS THE MECHANISM, NOT THE MEGABYTES. RSS on this host
 * swings far wider than the effect (the working-set trimmer moved an
 * identical fiber-pool arm 6.0-80.2 MiB across six runs), and asserting on
 * a 2% reclaim against that noise would be a coin flip dressed as a test.
 * What is deterministic is the ARMING: both arms run the SAME BINARY and
 * differ only in the env knob.
 *
 * THE ARMS:
 *   trim off (SCR_HEAP_TRIM_MS=0) -- the default, the pre-trim runtime,
 *     and the negative control: the seam must print NOTHING. A trim that
 *     ran and released nothing prints `releasedKiB=0`, so "no lines" and
 *     "no bytes" stay distinguishable readings rather than the same zero.
 *     This is the exact property that let the fiber pool's diagnostic be
 *     trusted when a user's service could not pair.
 *   trim on  -- must print windows, and must not change what the program
 *     prints.
 *   census on -- the FLOOR. busy bytes are what no trim can ever go below.
 *     A run whose census says the heap is nearly all busy is telling you
 *     the retention is a peak problem, not a trim problem.
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
const src = join(repoRoot, "tests/fixtures/heap-trim/churn.ts");

interface Window {
  readonly before: number;
  readonly after: number;
  readonly released: number;
  readonly largestFree: number;
  readonly us: number;
  readonly trims: number;
}

interface Census {
  readonly busyKiB: number;
  readonly freeKiB: number;
  readonly busyBlocks: number;
}

function parseWindows(stderr: string): Window[] {
  const out: Window[] = [];
  for (const line of stderr.split("\n")) {
    const m =
      /^\[heaptrim] window commitKiB=(\d+)->(\d+) releasedKiB=(\d+) largestFreeKiB=(\d+) us=(\d+) trims=(\d+)/.exec(
        line.trim()
      );
    if (m) {
      out.push({
        before: Number(m[1]),
        after: Number(m[2]),
        released: Number(m[3]),
        largestFree: Number(m[4]),
        us: Number(m[5]),
        trims: Number(m[6]),
      });
    }
  }
  return out;
}

function parseCensus(stderr: string): Census[] {
  const out: Census[] = [];
  for (const line of stderr.split("\n")) {
    const m = /^\[heaptrim] census busyKiB=(\d+) freeKiB=(\d+) uncommittedKiB=(\d+) busyBlocks=(\d+)/.exec(
      line.trim()
    );
    if (m) out.push({ busyKiB: Number(m[1]), freeKiB: Number(m[2]), busyBlocks: Number(m[4]) });
  }
  return out;
}

async function runArm(
  bin: string,
  trimMs: number,
  extra: Readonly<Record<string, string>> = {}
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(bin, [], {
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      SCR_HEAP_TRIM_MS: String(trimMs),
      SCR_HEAP_TRIM_STAT: "1",
      CHURN_BLOCKS: "20000",
      CHURN_TAIL_MS: "1200",
      ...extra,
    },
  });
  return { stdout: stdout.replace(/\r\n/g, "\n"), stderr };
}

describe("the idle seam trims the heap, behind a knob, and says so", () => {
  const key = createHash("sha256")
    .update(readFileSync(src))
    .update(sanitize ? "san" : "plain")
    .digest("hex")
    .slice(0, 16);
  const dir = join(cacheDir, `heap-trim-${key}`);
  let bin = "";
  let expected = "";

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    const result = await compile(src, {
      outPath: join(dir, exeName("churn")),
      outDir: dir,
      sanitize,
    });
    if (!result.ok) {
      throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    }
    bin = result.binaryPath;
    /* 4 rounds x 20000 blocks, one survivor in twenty. */
    expected = "churn 80000 4000\ndone\n";
  }, 300_000);

  test("trim off prints no windows at all (the negative control)", async () => {
    const { stdout, stderr } = await runArm(bin, 0);
    expect(stdout).toBe(expected);
    expect(parseWindows(stderr)).toEqual([]);
    expect(parseCensus(stderr)).toEqual([]);
  }, 240_000);

  test("trim on runs windows and does not change the program", async () => {
    const { stdout, stderr } = await runArm(bin, 50);
    expect(stdout).toBe(expected);
    const windows = parseWindows(stderr);
    /* The positive control: the seam must actually have been reached. A
     * tail of 1200 ms over 50 ms windows leaves no room for zero. */
    expect(windows.length).toBeGreaterThanOrEqual(4);
    /* The counter is monotonic and starts at 1, which is what tells a
     * reader that "released 0" means ran-and-found-nothing. */
    expect(windows[0]!.trims).toBe(1);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!.trims).toBe(windows[i - 1]!.trims + 1);
    }
    /* Every window reports a real commit reading, not a failed syscall. */
    for (const w of windows) expect(w.before).toBeGreaterThan(0);
  }, 240_000);

  test("the census reports the floor the trim cannot go below", async () => {
    const { stdout, stderr } = await runArm(bin, 50, { SCR_HEAP_TRIM_CENSUS: "1" });
    expect(stdout).toBe(expected);
    const census = parseCensus(stderr);
    expect(census.length).toBeGreaterThanOrEqual(4);
    /* A heap with a live program in it has busy blocks; a census that says
     * otherwise has walked the wrong heap. */
    for (const c of census) {
      expect(c.busyBlocks).toBeGreaterThan(0);
      expect(c.busyKiB).toBeGreaterThan(0);
    }
    /* And the census must accompany, not replace, the window line. */
    expect(parseWindows(stderr).length).toBeGreaterThanOrEqual(census.length - 1);
  }, 240_000);
});
