/* The lease's contract: which scratch directories a run is still using.
 *
 * prune-scratch.test.ts is about what the sweep DOES with an answer. This
 * file is about the answer — and the two halves of it that the in-run
 * bound rests on, each of which fails in the opposite direction:
 *
 *   - a released lease must READ as released, or a gate reclaims nothing
 *     while it runs (the 16 GB tree, the chunked workaround);
 *   - a held one must NOT, or a sweep deletes a directory a test is
 *     compiling into, which surfaces as a flaky gate rather than as a
 *     full disk.
 *
 * The lock is tested through `sweepRemove` directly, because that is the
 * only place the race it exists for can be stated: the sweep's own
 * candidate filter would never hand a held directory to it, so a lock that
 * had stopped working would be invisible from prune-scratch.test.ts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  LEASES_DIR,
  heldNames,
  holdScratch,
  leaseReleased,
  readLease,
  releaseAllHeld,
  releaseScratch,
  sweepDue,
  sweepRemove,
} from "./scratch-lease.mjs";

const MB = 1024 * 1024;
let root: string;

/** The pid of a child that has already exited — a real dead process. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
  if (typeof r.pid !== "number") throw new Error("could not spawn a child");
  return r.pid;
}

/** Rewrite a lease the way another process would have left it. */
function planLease(name: string, rec: Record<string, unknown>): void {
  writeFileSync(join(root, LEASES_DIR, `${name}.json`), JSON.stringify(rec));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scr-lease-"));
});
afterEach(() => {
  releaseAllHeld();
  rmSync(root, { recursive: true, force: true });
});

describe("holdScratch / releaseScratch", () => {
  test("a hold creates the directory and publishes a held lease naming this process", () => {
    const dir = holdScratch(root, "0123456789abcdef");
    expect(dir).toBe(join(root, "0123456789abcdef"));
    expect(existsSync(dir)).toBe(true);
    const lease = readLease(root, "0123456789abcdef");
    expect(lease?.state).toBe("held");
    expect(lease?.pid).toBe(process.pid);
    expect(leaseReleased(lease)).toBe(false);
    expect(heldNames(root)).toEqual(["0123456789abcdef"]);
  });

  test("a release flips the lease and caches what the directory measured", () => {
    /* The cache is not a convenience: without it every sweep re-walks
     * every program directory, and an in-run sweep that expensive cannot
     * run often enough to bound anything. */
    const dir = holdScratch(root, "1111111111111111");
    writeFileSync(join(dir, "program.exe"), Buffer.alloc(3 * MB));
    const bytes = releaseScratch(root, "1111111111111111");

    expect(bytes).toBe(3 * MB);
    const lease = readLease(root, "1111111111111111");
    expect(lease?.state).toBe("done");
    expect(lease?.bytes).toBe(3 * MB);
    expect(typeof lease?.newest).toBe("number");
    expect(leaseReleased(lease)).toBe(true);
    expect(heldNames(root)).toEqual([]);
  });

  test("the per-test hook's release covers every directory the test took", () => {
    /* A test takes up to three at once — llvm-differential-suite builds
     * the llvm, c and default lanes of one program into three keys — and
     * the hook releases them together when the test ends. */
    holdScratch(root, "2222222222222222");
    holdScratch(root, "3333333333333333");
    holdScratch(root, "4444444444444444");
    expect(heldNames(root)).toHaveLength(3);

    releaseAllHeld();
    expect(heldNames(root)).toEqual([]);
    for (const n of ["2222222222222222", "3333333333333333", "4444444444444444"]) {
      expect(readLease(root, n)?.state).toBe("done");
    }
  });

  test("a hold by a DEAD process reads as released", () => {
    /* Otherwise a worker that crashed mid-test holds its directories for
     * the rest of the run behind a record nobody will ever update. It is
     * the same argument run-registry.mjs makes about a crashed gate, one
     * level down. */
    holdScratch(root, "5555555555555555");
    planLease("5555555555555555", { v: 1, pid: deadPid(), state: "held", at: Date.now() });
    expect(leaseReleased(readLease(root, "5555555555555555"))).toBe(true);
  });

  test("no lease is NOT a release", () => {
    // An uninstrumented suite's directory: silence means "assume in use".
    expect(readLease(root, "6666666666666666")).toBe(null);
    expect(leaseReleased(null)).toBe(false);
  });

  test("releasing a directory another LIVE process has re-taken does not mark it done", () => {
    /* Our use of it is over, but the lease is theirs now, and marking it
     * done would hand the sweep a permission we no longer own. */
    holdScratch(root, "7777777777777777");
    // Stand in for "someone else, and alive": the parent of this process.
    planLease("7777777777777777", { v: 1, pid: process.ppid, state: "held", at: Date.now() });
    releaseScratch(root, "7777777777777777");
    expect(readLease(root, "7777777777777777")?.state).toBe("held");
  });
});

describe("sweepRemove", () => {
  test("it removes a finished directory and its lease together", async () => {
    const dir = holdScratch(root, "8888888888888888");
    writeFileSync(join(dir, "program.exe"), Buffer.alloc(1 * MB));
    releaseScratch(root, "8888888888888888");

    expect(await sweepRemove(root, "8888888888888888")).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(root, LEASES_DIR, "8888888888888888.json"))).toBe(false);
  });

  test("it REFUSES a directory that has been re-taken, and leaves its bytes alone", async () => {
    /* The race the lock exists for: a sweep decides a directory is
     * finished, and before it deletes, a retry takes the same key and
     * starts compiling into it. Acquisition publishes "held" under the
     * lock and removal re-reads the state under the same lock, so the two
     * cannot interleave into a compile writing into a directory being
     * deleted. The sweep's own candidate filter would never hand a held
     * directory here, which is exactly why this has to be asserted on
     * sweepRemove directly. */
    const dir = holdScratch(root, "9999999999999999");
    writeFileSync(join(dir, "program.exe"), Buffer.alloc(1 * MB));
    releaseScratch(root, "9999999999999999");
    holdScratch(root, "9999999999999999"); // re-taken, by a live process

    expect(await sweepRemove(root, "9999999999999999")).toBe(false);
    expect(existsSync(join(dir, "program.exe"))).toBe(true);
    expect(readFileSync(join(dir, "program.exe")).length).toBe(1 * MB);
  });

  test("a directory held by a dead process is removable", async () => {
    const dir = holdScratch(root, "aaaaaaaaaaaaaaaa");
    writeFileSync(join(dir, "program.exe"), Buffer.alloc(1 * MB));
    planLease("aaaaaaaaaaaaaaaa", { v: 1, pid: deadPid(), state: "held", at: Date.now() });

    expect(await sweepRemove(root, "aaaaaaaaaaaaaaaa")).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  test("the bookkeeping directory can never be a subject", async () => {
    holdScratch(root, "bbbbbbbbbbbbbbbb"); // so the lease store exists at all
    // Names that could escape the root, or name the lease store itself.
    for (const bad of [LEASES_DIR, ".runs", "..", "a/b", "a\\b", ""]) {
      expect(await sweepRemove(root, bad)).toBe(false);
    }
    expect(existsSync(join(root, LEASES_DIR))).toBe(true);
  });
});

describe("sweepDue", () => {
  const E = (o: Record<string, string>) => ({ ...o }) as unknown as NodeJS.ProcessEnv;
  const MIN = 60_000;

  test("enough released bytes is a reason to walk", () => {
    expect(sweepDue(512 * MB, 0, E({}))).toBe(true);
    expect(sweepDue(511 * MB, 0, E({}))).toBe(false);
    expect(sweepDue(1 * MB, 0, E({ SCRIPTC_TEST_SCRATCH_CHECK_MB: "1" }))).toBe(true);
  });

  test("a worker that has released NOTHING still sweeps once the timer elapses", () => {
    /* The regression this clause exists for, and it cost a full-gate run
     * to find: the byte counter is per worker and counts only what THAT
     * worker released, so a worker running an uninstrumented file never
     * reaches the threshold — however much finished scratch other workers
     * have left evictable. Measured: the corpus phase held the tree in a
     * 3.0-5.2 GB band, and the non-corpus phase then climbed to 6.6 GB
     * with 2,939 released directories (5.32 GB) lying there, because no
     * live worker was releasing anything. Reclamation has to be a
     * function of the tree, not of what this worker happens to run. */
    expect(sweepDue(0, MIN, E({}))).toBe(true);
    expect(sweepDue(0, MIN - 1, E({}))).toBe(false);
    expect(sweepDue(0, 5_000, E({ SCRIPTC_TEST_SCRATCH_CHECK_S: "5" }))).toBe(true);
  });

  test("a zero cap turns the sweep off entirely", () => {
    // pruneScratchOnce returns immediately on a non-positive cap; walking
    // the tree to reach that conclusion is pure cost.
    expect(sweepDue(99 * 1024 * MB, 99 * MIN, E({ SCRIPTC_TEST_SCRATCH_MAX_MB: "0" }))).toBe(false);
  });
});
