/* The scratch sweep's contract, in both directions.
 *
 * A sweep that quietly evicted nothing would make every one of these pass
 * for the wrong reason, so each case asserts what it KEPT as well as what
 * it took: the cap is a real bound (over it, old key directories go), the
 * age floor is a real floor (a directory touched minutes ago survives even
 * when the tree is far over cap — that is what makes a concurrent
 * other-flavor run safe), and only content-key directories are eligible at
 * all (a suite's named fixture directory is never a candidate).
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { pruneScratchOnce } from "./prune-scratch.mjs";

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

  test("the age floor is honored even far over the cap", async () => {
    process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] = "1";
    keyDir("dddddddddddddddd", 8, 2 * 60 * 1000); // two minutes old: in use
    const r = await pruneScratchOnce(root, now);
    expect(r.evicted).toEqual([]);
    expect(existsSync(join(root, "dddddddddddddddd"))).toBe(true);
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

  test("a missing scratch tree is not an error", async () => {
    const r = await pruneScratchOnce(join(root, "does-not-exist"), now);
    expect(r).toEqual({ total: 0, freed: 0, evicted: [], spared: 0 });
  });
});
