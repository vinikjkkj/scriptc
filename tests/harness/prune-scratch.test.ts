/* The scratch sweep's contract, in both directions.
 *
 * A sweep that quietly evicted nothing would make every one of these pass
 * for the wrong reason, so each case asserts what it KEPT as well as what
 * it took: the cap is a real bound (over it, old key directories go), the
 * liveness floor is a real floor (what a live run may hold survives even
 * when the tree is far over cap — that is what makes a concurrent
 * other-flavor run safe), and only content-key directories are eligible at
 * all (a suite's named fixture directory is never a candidate).
 *
 * The floor is stated directly here via `opts.floor` rather than by
 * spawning processes to stand for live runs: this file is about what the
 * sweep DOES with an answer, and run-registry.test.ts is about getting the
 * answer right. The two cases that matter are both here — a floor that
 * protects, and NO floor (nobody alive), which is the relaunch-after-a-
 * dead-gate case the age-based version got wrong.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { pruneScratchOnce } from "./prune-scratch.mjs";
import { registerRun } from "./run-registry.mjs";

/** The pid of a child that has already exited — a real dead run. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
  if (typeof r.pid !== "number") throw new Error("could not spawn a child to kill");
  return r.pid;
}

let root: string;
const MB = 1024 * 1024;
const now = Date.now();
const HOUR = 60 * 60 * 1000;

/** A program directory of `mb` megabytes whose files last changed `ageMs` ago. */
function keyDir(name: string, mb: number, ageMs: number): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, "program.exe");
  writeFileSync(exe, Buffer.alloc(mb * MB));
  const when = new Date(now - ageMs);
  utimesSync(exe, when, when);
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scr-prune-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"];
});

describe("pruneScratchOnce", () => {
  test("under the cap it touches nothing", async () => {
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "64";
    keyDir("0123456789abcdef", 8, 5 * HOUR);
    const r = await pruneScratchOnce(root, now);
    expect(r.evicted).toEqual([]);
    expect(r.freed).toBe(0);
    expect(existsSync(join(root, "0123456789abcdef"))).toBe(true);
  });

  test("over the cap it evicts oldest-first, down to 75% and no further", async () => {
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "16";
    keyDir("aaaaaaaaaaaaaaaa", 8, 9 * HOUR); // oldest
    keyDir("bbbbbbbbbbbbbbbb", 8, 8 * HOUR);
    keyDir("cccccccccccccccc", 8, 7 * HOUR); // newest
    const r = await pruneScratchOnce(root, now);
    // 24 MB against a 16 MB cap: evicting the two oldest lands at 8 MB,
    // which is under 75% of 16 — so the newest must survive.
    expect(r.evicted).toEqual(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
    expect(existsSync(join(root, "cccccccccccccccc"))).toBe(true);
    expect(r.freed).toBe(16 * MB);
  });

  test("a live run's floor is honored even far over the cap", async () => {
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    keyDir("dddddddddddddddd", 8, 2 * 60 * 1000); // written since the peer started
    // A peer that started five minutes ago: everything it may hold has an
    // mtime at or after that instant.
    const r = await pruneScratchOnce(root, now, { floor: now - 5 * 60 * 1000 });
    expect(r.evicted).toEqual([]);
    expect(existsSync(join(root, "dddddddddddddddd"))).toBe(true);
  });

  test("with a live run, the floor splits what it may hold from what it cannot", async () => {
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    // The peer started 30 minutes ago. It cannot have touched anything
    // before that, so the older directory is not its — and the age-based
    // floor would have spared BOTH of these for being under an hour old.
    const floor = now - 30 * 60 * 1000;
    keyDir("1111111111111111", 8, 90 * 60 * 1000); // predates the peer
    keyDir("2222222222222222", 8, 10 * 60 * 1000); // the peer may hold it
    const r = await pruneScratchOnce(root, now, { floor });
    expect(r.evicted).toEqual(["1111111111111111"]);
    expect(existsSync(join(root, "1111111111111111"))).toBe(false);
    expect(existsSync(join(root, "2222222222222222"))).toBe(true);
  });

  test("with nothing alive, a relaunch recovers minutes-old directories", async () => {
    /* The regression this file exists for. A gate died moments ago and the
     * next one starts: every directory is minutes old, and the hour-long
     * age floor protected all of it, so the relaunch recovered zero bytes
     * and ran out of disk. Nothing is alive, so nothing is protected. */
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    keyDir("3333333333333333", 8, 2 * 60 * 1000);
    keyDir("4444444444444444", 8, 1 * 60 * 1000);
    const r = await pruneScratchOnce(root, now, { floor: null });
    expect(r.evicted).toEqual(["3333333333333333", "4444444444444444"]);
    expect(r.freed).toBe(16 * MB);
    expect(existsSync(join(root, "3333333333333333"))).toBe(false);
    expect(existsSync(join(root, "4444444444444444"))).toBe(false);
  });

  test("the registry directory is neither a candidate nor counted as spared", async () => {
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    keyDir("5555555555555555", 8, 9 * HOUR);
    mkdirSync(join(root, ".runs"), { recursive: true });
    writeFileSync(join(root, ".runs", "999999.json"), '{"pid":999999,"startedAt":1}');

    const r = await pruneScratchOnce(root, now, { floor: null });
    expect(r.evicted).toEqual(["5555555555555555"]);
    expect(existsSync(join(root, ".runs"))).toBe(true); // bookkeeping survives
    expect(r.spared).toBe(0); // and is not reported as kept program data
  });

  test("only content-key directories are candidates", async () => {
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    keyDir("eeeeeeeeeeeeeeee", 8, 9 * HOUR);
    // A suite's named fixture directory, same age, same size.
    const named = join(root, "cli-flush");
    mkdirSync(named, { recursive: true });
    const file = join(named, "blob.bin");
    writeFileSync(file, Buffer.alloc(8 * MB));
    const when = new Date(now - 9 * HOUR);
    utimesSync(file, when, when);

    const r = await pruneScratchOnce(root, now);
    expect(r.evicted).toEqual(["eeeeeeeeeeeeeeee"]); // the key dir went
    expect(existsSync(named)).toBe(true); // the named one did not
    expect(r.spared).toBe(1);
  });

  /* The two cases above state a floor directly. These two go through the
   * registry instead, because the defect being fixed lived exactly in the
   * join: a sweep that honors its floor correctly still recovers nothing
   * if the floor it is handed is the wrong question's answer. */
  test("end to end: a dead run's record does not protect its scratch", async () => {
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    keyDir("6666666666666666", 8, 2 * 60 * 1000); // minutes old, as after a crash
    registerRun(root, deadPid()); // teardown never ran

    const r = await pruneScratchOnce(root, now); // no floor: ask the registry
    expect(r.evicted).toEqual(["6666666666666666"]);
    expect(r.freed).toBe(8 * MB);
  });

  test("end to end: a live run's record does protect it", async () => {
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    registerRun(root); // this process: registered now, unquestionably alive
    /* Written AFTER the peer started, which is the invariant the floor
     * relies on — a run cannot touch a directory before it exists, and
     * touching always writes (a cache hit still renames the binary into
     * place). `keyDir`'s ages are relative to this file's load time, so
     * the mtime is re-stamped to the real present here on purpose. */
    const dir = keyDir("7777777777777777", 8, 0);
    const written = new Date();
    utimesSync(join(dir, "program.exe"), written, written);

    const r = await pruneScratchOnce(root, Date.now(), { selfPid: -1 });
    expect(r.evicted).toEqual([]);
    expect(existsSync(join(root, "7777777777777777"))).toBe(true);
  });

  test("a missing scratch tree is not an error", async () => {
    const r = await pruneScratchOnce(join(root, "does-not-exist"), now);
    expect(r).toEqual({ total: 0, freed: 0, evicted: [], spared: 0 });
  });
});
