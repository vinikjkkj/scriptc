/* Who is alive, asked of the process table.
 *
 * The sweep's safety rests entirely on these answers, so each case pins
 * both directions: a live record is seen AND a dead one is not, an absent
 * registry reads as "nothing is alive" AND an unreadable one reads as
 * "cannot tell" — the distinction the whole fallback depends on, since
 * only the first is permission to delete.
 *
 * No test here sleeps or spawns a long-lived process to stand for a live
 * run: this process IS a live process, and passing a different `selfPid`
 * turns it into the peer under test. The dead pid is a real one — a child
 * that has already exited — because a fabricated pid would only prove that
 * a number nobody used is not running.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { liveRuns, pidAlive, registerRun, scratchFloor, UNKNOWN_FLOOR_MS } from "./run-registry.mjs";

let root: string;
/** A pid that cannot collide with this process, so our own record reads as a peer. */
const NOT_ME = -1;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scr-runs-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The pid of a child that has already exited. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
  if (typeof r.pid !== "number") throw new Error("could not spawn a child to kill");
  return r.pid;
}

describe("pidAlive", () => {
  test("true for this process, false for one that has exited", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(deadPid())).toBe(false);
  });
});

describe("liveRuns", () => {
  test("no registry is an answer, not an absence", () => {
    expect(liveRuns(root)).toEqual([]); // asked; nobody is registered
    expect(scratchFloor(root)).toBeNull(); // so nothing is protected
  });

  test("an unreadable registry is NOT reported as empty", () => {
    // A file where the directory should be: readdir fails with ENOTDIR,
    // which is "could not ask" and must never read as "nothing is alive".
    const file = join(root, ".runs");
    writeFileSync(file, "not a directory");
    expect(liveRuns(root)).toBeNull();

    const now = Date.now();
    expect(scratchFloor(root, now)).toBe(now - UNKNOWN_FLOOR_MS); // falls back to the clock
  });

  test("a registered run is visible to others and invisible to itself", () => {
    registerRun(root);
    expect(liveRuns(root, process.pid)).toEqual([]); // our own dirs do not exist yet
    const peers = liveRuns(root, NOT_ME);
    expect(peers).toHaveLength(1);
    expect(peers![0]!.pid).toBe(process.pid);
    expect(peers![0]!.startedAt).toBeLessThanOrEqual(Date.now());
  });

  test("unregistering removes it", () => {
    const unregister = registerRun(root);
    expect(liveRuns(root, NOT_ME)).toHaveLength(1);
    unregister();
    expect(liveRuns(root, NOT_ME)).toEqual([]);
    expect(existsSync(join(root, ".runs", `${process.pid}.json`))).toBe(false);
  });

  test("a dead run's record is ignored and swept up", () => {
    // The killed-gate case: teardown never ran, so the record is still there.
    const pid = deadPid();
    registerRun(root, pid);
    expect(existsSync(join(root, ".runs", `${pid}.json`))).toBe(true);

    expect(liveRuns(root, NOT_ME)).toEqual([]);
    expect(existsSync(join(root, ".runs", `${pid}.json`))).toBe(false); // pruned
  });

  test("a torn record is not evidence of life", () => {
    registerRun(root);
    writeFileSync(join(root, ".runs", "4242.json"), "{half-writ");
    const peers = liveRuns(root, NOT_ME);
    expect(peers).toHaveLength(1);
    expect(peers![0]!.pid).toBe(process.pid);
  });
});

describe("scratchFloor", () => {
  test("with a live run it is that run's start, not the clock", () => {
    registerRun(root);
    const floor = scratchFloor(root, Date.now(), NOT_ME);
    expect(floor).not.toBeNull();
    // The hour-based floor it replaces would have sat an hour in the past;
    // a run that just started protects only what was written since.
    expect(floor!).toBeGreaterThan(Date.now() - UNKNOWN_FLOOR_MS);
  });

  test("with several live runs it is the EARLIEST start", () => {
    registerRun(root);
    // A second live record for the same (live) process, stamped older: the
    // floor must follow the oldest live run, or the sweep would delete what
    // the longest-running one is still holding.
    const older = Date.now() - 90 * 60 * 1000;
    writeFileSync(
      join(root, ".runs", "other.json"),
      JSON.stringify({ pid: process.pid, startedAt: older, flavor: "san" }),
    );
    expect(scratchFloor(root, Date.now(), NOT_ME)).toBe(older);
  });

  test("a dead run does not hold the floor up", () => {
    // Registered moments ago and already gone — the killed-gate shape.
    // Recent, and irrelevant: the process holds nothing, so there is no
    // floor at all and the relaunch may reclaim everything.
    registerRun(root, deadPid());
    expect(scratchFloor(root, Date.now(), NOT_ME)).toBeNull();
    expect(readdirSync(join(root, ".runs"))).toEqual([]);
  });
});
