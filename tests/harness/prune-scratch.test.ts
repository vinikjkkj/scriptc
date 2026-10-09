/* The scratch sweep's contract, in both directions.
 *
 * A sweep that quietly evicted nothing would make every one of these pass
 * for the wrong reason, so each case asserts what it KEPT as well as what
 * it took: the cap is a real bound (over it, old directories go), the
 * liveness floor is a real floor (what a live run may hold survives even
 * when the tree is far over cap — that is what makes a concurrent
 * other-flavor run safe), a RELEASED LEASE overrides that floor (which is
 * the whole of the in-run bound — without it a gate reclaims nothing until
 * it ends), and the CAS is never a candidate at all.
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
import { holdScratch, releaseScratch } from "./scratch-lease.mjs";

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

  test("a NAME-prefixed program directory is a candidate too", async () => {
    /* It was not, and 542 of them held 2.63 GB that nothing could ever
     * evict: `server-<key>`, `npm-<key>`, `fetch-<key>` are per-program
     * directories that merely spell their key with a prefix, and the
     * 16-hex rule read them as fixtures a suite might be holding a path to
     * across its whole file. Liveness and the lease answer that question
     * directly now, for named and hex-named directories alike. */
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    keyDir("eeeeeeeeeeeeeeee", 8, 9 * HOUR);
    keyDir("fetch-0123456789abcdef", 8, 9 * HOUR);

    const r = await pruneScratchOnce(root, now);
    expect([...r.evicted].sort()).toEqual(["eeeeeeeeeeeeeeee", "fetch-0123456789abcdef"]);
    expect(existsSync(join(root, "fetch-0123456789abcdef"))).toBe(false);
    expect(r.freed).toBe(16 * MB);
  });

  test("the CAS is never a candidate, and is not counted against the cap", async () => {
    /* SCRIPTC_CACHE_DIR defaults to `cas` INSIDE this tree, it IS a build
     * input — the binary cache this tree's cheap-eviction argument rests
     * on — and it carries its own size cap. Counting it toward this cap
     * would also make the cap unreachable whenever the CAS alone exceeded
     * it, which is how a widened rule quietly becomes an unconditional
     * purge of everything else. */
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "16";
    keyDir("cas", 64, 9 * HOUR); // far over the cap on its own
    keyDir("aaaaaaaaaaaaaaaa", 8, 9 * HOUR);

    const r = await pruneScratchOnce(root, now, { floor: null });
    expect(r.total).toBe(8 * MB); // the CAS's 64 MB is not in the total
    expect(r.evicted).toEqual([]); // so the tree is under cap and nothing moves
    expect(existsSync(join(root, "cas"))).toBe(true);
    expect(r.spared).toBe(1);
  });

  /* THE IN-RUN BOUND. Everything above is about a tree between runs. These
   * are about the tree DURING one: every directory is newer than the live
   * run's own start, so the floor protects all of it by construction and a
   * full gate reclaimed nothing until it ended — which is why `pnpm test`
   * had to be driven in chunks on this host. A released lease is the finer
   * fact that breaks that tie. */
  test("a released lease is evicted even though the live run's floor protects it", async () => {
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    const floor = now - 5 * 60 * 1000; // the run started five minutes ago
    keyDir("8888888888888888", 8, 60 * 1000); // written BY that run
    releaseScratch(root, "8888888888888888"); // and its test has ended

    const r = await pruneScratchOnce(root, now, { floor });
    expect(r.evicted).toEqual(["8888888888888888"]);
    expect(existsSync(join(root, "8888888888888888"))).toBe(false);
    expect(r.freed).toBe(8 * MB);
  });

  test("a directory the run is STILL USING survives the same sweep", async () => {
    /* The other direction, and the one that shows up as a flaky gate
     * rather than as a full disk: a held lease says a test is inside that
     * directory right now.
     *
     * The companion eviction here is a PRE-FLOOR directory, not a released
     * one, on purpose: it proves the sweep actually ran and took what it
     * was allowed to — without which this would pass for the wrong reason
     * — while staying independent of the lease rule, so that breaking the
     * in-run bound is caught by the test above and by nothing else. */
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    const floor = now - 5 * 60 * 1000;
    const inUse = holdScratch(root, "9999999999999999");
    writeFileSync(join(inUse, "program.exe"), Buffer.alloc(8 * MB));
    keyDir("aaaaaaaaaaaaaaab", 8, 90 * 60 * 1000); // predates the run

    const r = await pruneScratchOnce(root, now, { floor });
    expect(r.evicted).toEqual(["aaaaaaaaaaaaaaab"]); // the sweep did run
    expect(existsSync(inUse)).toBe(true); // and left the held one alone
    expect(existsSync(join(inUse, "program.exe"))).toBe(true);
  });

  test("a protected directory does not end the scan: released ones behind it still go", async () => {
    /* Eviction order is LRU, and in a live gate released and protected
     * directories are interleaved in it — a test finishing at minute 40
     * releases a directory older than one a test started at minute 50 is
     * still writing. Stopping at the first protected directory, which is
     * what the floor rule alone allows (everything after it is newer, so
     * everything after it is protected too), would therefore reclaim
     * almost nothing in a run while looking exactly like a working
     * sweep. */
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    const floor = now - 30 * 60 * 1000;
    // Held, and written 20 minutes in: a test is inside it right now.
    const inUse = holdScratch(root, "cccccccccccccccc");
    const exe = join(inUse, "program.exe");
    writeFileSync(exe, Buffer.alloc(8 * MB));
    const when = new Date(now - 20 * 60 * 1000);
    utimesSync(exe, when, when);
    keyDir("dddddddddddddddd", 8, 10 * 60 * 1000); // newer, but finished
    releaseScratch(root, "dddddddddddddddd");

    const r = await pruneScratchOnce(root, now, { floor });
    expect(r.evicted).toEqual(["dddddddddddddddd"]);
    expect(existsSync(exe)).toBe(true);
  });

  test("an UNLEASED directory of this run is spared: silence is not permission", async () => {
    /* An uninstrumented suite creates its scratch without a lease. The
     * safe reading of silence is that the directory is in use, so it is
     * bounded by the floor alone — an uninstrumented suite under-reclaims
     * rather than losing a directory out from under itself. */
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    const floor = now - 5 * 60 * 1000;
    keyDir("bbbbbbbbbbbbbbbc", 8, 60 * 1000); // no lease at all

    const r = await pruneScratchOnce(root, now, { floor });
    expect(r.evicted).toEqual([]);
    expect(existsSync(join(root, "bbbbbbbbbbbbbbbc"))).toBe(true);
  });

  test("an unleased directory is spared BEFORE its first byte lands", async () => {
    /* THE SIBLING OF THE CASE ABOVE, AND THE ONE IT COULD NOT CATCH. That
     * test writes a file and then asserts the directory survives, so it only
     * ever exercised directories the walk can DATE. `measure` starts
     * `newest` at 0 and raises it from FILE mtimes alone, so a directory with
     * no file under it yet reports as the EPOCH -- it sorts FIRST in the
     * eviction order AND fails `newest > floor`, which is the floor's whole
     * mechanism for sparing live work. Both failures at once, so such a
     * directory is not merely evictable: it is the first thing taken.
     *
     * THE WINDOW IS REAL. A suite that calls mkdirSync on its outDir and then
     * starts a compile owns an empty directory until that compile writes its
     * first byte. Measured 2026-10-09, shard 6 of a merge gate: an in-run
     * sweep in another worker deleted `microtask-turns-<key>` while the
     * c-backend test was inside compile(), and it surfaced as ENOENT on the
     * emitted turns.c -- a red that names a behavioural test and is not one.
     *
     * The companion eviction is a genuinely old directory, so this cannot
     * pass by the sweep doing nothing. */
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    const floor = now - 5 * 60 * 1000;
    // Exactly what mkdirSync(outDir, { recursive: true }) leaves behind.
    mkdirSync(join(root, "microtask-turns-0123456789abcdef", "c"), { recursive: true });
    keyDir("aaaaaaaaaaaaaaac", 8, 9 * HOUR); // genuinely old: puts the tree over cap

    const r = await pruneScratchOnce(root, now, { floor });
    expect(r.evicted).toEqual(["aaaaaaaaaaaaaaac"]); // the sweep did run
    expect(existsSync(join(root, "microtask-turns-0123456789abcdef", "c"))).toBe(true);
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
