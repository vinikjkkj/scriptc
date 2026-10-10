/* THE IDLE SEAM HANDS SQLITE'S PAGE CACHE BACK — AND SINCE 2026-10-10 IT
 * DOES SO BY DEFAULT.
 *
 * The feature landed 2026-10-03 (merge 040d22982, gated 6/6) measuring
 * -17.19 MiB private commit and -17.91 MiB working set on a 129.6 MB
 * database, and shipped OFF on the stated principle that a new runtime
 * default arrives after a feature's debut rather than with it. The
 * default was flipped to 1000 ms once that condition was met.
 *
 * WHY THIS FILE EXISTS AT ALL. The knob had no test. Its sibling
 * SCR_HEAP_TRIM_MS has tests/harness/heap-trim.test.ts; this one was
 * defended only by the measurements in its own commit messages, which no
 * gate re-runs. A default that ships ON with nothing exercising it is a
 * default the gate cannot defend, and flipping it without this file would
 * have been the change that most needed a test getting the least.
 *
 * THIS PINS THE MECHANISM, NOT THE MEGABYTES — the same decision
 * heap-trim.test.ts records, for the same reason. The bytes reclaimed
 * depend on the database, the host and the page cache's state; what is
 * deterministic is WHICH DECISION the seam takes, and every arm below
 * runs the SAME BINARY and differs only in environment.
 *
 * THE ARMS, and the middle one is the one that would have been red
 * yesterday:
 *   opted out (SCR_SQLITE_IDLE_RELEASE_MS=0) -- the negative control, and
 *     the pre-2026-10-10 default. The seam must print NOTHING.
 *   DEFAULT (the variable is not set at all) -- must release. This is the
 *     arm that tests the flip itself: before the flip it read exactly the
 *     same as the opted-out arm, so it is a check that could have come
 *     out red, which is the property this project demands of a control.
 *   in use -- a connection queried inside the window must be DECLINED and
 *     say so. `released=0 inUse=0` and `released=0 inUse=N` are different
 *     readings, and only the second proves the last-use stamp is read
 *     rather than assumed. That distinction is what 8a507dfc1 found the
 *     feature's first shape could not make.
 *
 * The per-connection lines are gated on the SCR_SQLITE_IDLE_STAT env var
 * alone. The aggregate `window=` line is behind the compile-time
 * SCR_ASYNC_STAT, so nothing here depends on a special build.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";
const src = join(repoRoot, "tests/fixtures/sqlite-idle/pagecache.ts");

interface Decision {
  readonly idleMs: number;
  readonly released: boolean;
}

function parseDecisions(stderr: string): Decision[] {
  const out: Decision[] = [];
  for (const line of stderr.split("\n")) {
    const m = /^\[sqlidle] db=.* idleMs=(\d+) (RELEASED|IN-USE, kept)$/.exec(line.trim());
    if (m) out.push({ idleMs: Number(m[1]), released: m[2] === "RELEASED" });
  }
  return out;
}

describe("the idle seam releases SQLite's page cache, by default, and says which it kept", () => {
  const key = createHash("sha256")
    .update(readFileSync(src))
    .update(sanitize ? "san" : "plain")
    .digest("hex")
    .slice(0, 16);
  const dir = join(cacheDir, `sqlite-idle-${key}`);
  let bin = "";

  async function runArm(
    tag: string,
    env: Readonly<Record<string, string>>,
    fixture: Readonly<Record<string, string>> = {}
  ): Promise<{ stdout: string; stderr: string }> {
    /* A fresh database per arm: a cache warmed by a previous arm would
     * make "it released something" true for the wrong reason. */
    const db = join(dir, `${tag}.sqlite`);
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(db + suffix, { force: true });
    }
    const { stdout, stderr } = await execFileAsync(bin, [db], {
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        SCR_SQLITE_IDLE_STAT: "1",
        SQLIDLE_ROWS: "4000",
        SQLIDLE_TAIL_MS: "2500",
        SQLIDLE_TOUCH_MS: "0",
        ...fixture,
        ...env,
      },
    });
    return { stdout: stdout.replace(/\r\n/g, "\n"), stderr };
  }

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    const result = await compile(src, {
      outPath: join(dir, exeName("pagecache")),
      outDir: dir,
      sanitize,
    });
    if (!result.ok) {
      throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    }
    bin = result.binaryPath;
  }, 300_000);

  test("opted out prints no decisions at all (the negative control)", async () => {
    const { stdout, stderr } = await runArm("off", { SCR_SQLITE_IDLE_RELEASE_MS: "0" });
    expect(stdout).toBe("pagecache 4000 0\ndone\n");
    expect(parseDecisions(stderr)).toEqual([]);
  }, 240_000);

  test("the DEFAULT releases an untouched connection, with no variable set", async () => {
    /* SCR_SQLITE_IDLE_RELEASE_MS is deliberately absent here. Removing it
     * from the inherited environment matters: a parent that exported it
     * would make this arm measure the parent's choice, not the default. */
    const clean: Record<string, string | undefined> = { ...process.env };
    delete clean["SCR_SQLITE_IDLE_RELEASE_MS"];
    const db = join(dir, "default.sqlite");
    for (const suffix of ["", "-wal", "-shm"]) rmSync(db + suffix, { force: true });
    const { stdout, stderr } = await execFileAsync(bin, [db], {
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...clean,
        SCR_SQLITE_IDLE_STAT: "1",
        SQLIDLE_ROWS: "4000",
        SQLIDLE_TAIL_MS: "2500",
        SQLIDLE_TOUCH_MS: "0",
      },
    });
    expect(stdout.replace(/\r\n/g, "\n")).toBe("pagecache 4000 0\ndone\n");
    const decisions = parseDecisions(stderr);
    /* A 2500 ms silent tail over the 1000 ms default: the first window
     * only arms the deadline, so two fire. One is enough to pin the flip;
     * asserting two would be asserting the scheduler. */
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions.every((d) => d.released)).toBe(true);
    /* Nothing was released early: an untouched connection in a 1000 ms
     * window has been idle at least that long. */
    for (const d of decisions) expect(d.idleMs).toBeGreaterThanOrEqual(1000);
  }, 240_000);

  test("a connection queried inside the window is declined, not released", async () => {
    const { stdout, stderr } = await runArm(
      "inuse",
      { SCR_SQLITE_IDLE_RELEASE_MS: "400" },
      { SQLIDLE_TOUCH_MS: "50", SQLIDLE_TAIL_MS: "2000" }
    );
    expect(stdout.startsWith("pagecache 4000 ")).toBe(true);
    expect(stdout.endsWith("done\n")).toBe(true);
    const decisions = parseDecisions(stderr);
    /* The positive control for the stamp: the seam must have been reached
     * AND must have seen the connection as recently used. */
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    const kept = decisions.filter((d) => !d.released);
    expect(kept.length).toBeGreaterThanOrEqual(1);
    /* And a kept connection is kept for the stated reason: it was touched
     * inside the window it was judged against. */
    for (const d of kept) expect(d.idleMs).toBeLessThan(400);
  }, 240_000);
});
