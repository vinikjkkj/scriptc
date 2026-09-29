/* Which scratch program directories a run is STILL USING, and which ones
 * it has finished with.
 *
 * run-registry.mjs answers the cross-run question — could a live run be
 * holding this? — and its answer is a run's start time, because a run
 * cannot have touched a directory before it started and touching always
 * writes. That argument bounds the tree BETWEEN runs and says nothing
 * inside one: a run's own directories are all newer than its own start, so
 * during a full gate the sweep correctly spares every byte the gate itself
 * has written, and the tree grows past 16 GB with nothing able to reclaim
 * it. That is why `pnpm test` had to be chunked on this host.
 *
 * The finer fact this file records is a TEST'S completion. A scratch
 * program directory is taken by exactly one test, and when that test ends
 * nothing in the run will read it again:
 *
 *   - CONCURRENT SHARING IS ALREADY EXCLUDED. Two live tests sharing one
 *     scratch directory would be relinking each other's binary — Linux
 *     answers ETXTBSY, Windows a sharing violation — and the tree is
 *     deliberately keyed so that cannot happen: llvm-differential-suite.ts
 *     mixes the backend into its key and gives each lane its own binary
 *     BASENAME for exactly this reason, after the seven fs/path failures
 *     of CI run 29965245855. So "the test that took this directory has
 *     finished" means no live test holds it.
 *   - A LATER TEST THAT WANTS IT AGAIN LOSES NOTHING. Nothing in this tree
 *     is a build input: the executable is a COPY of the one in
 *     SCRIPTC_CACHE_DIR/bin and the .c beside it is rewritten by every
 *     compile, so a re-acquired directory costs one copyFile, not one
 *     zig cc. That is the same trade prune-scratch.mjs already argued.
 *
 * The record is a LEASE: a small JSON file under <root>/.leases, named for
 * the program directory it describes, flipped from "held" to "done" when
 * the test that took it ends. It is a sidecar rather than a dotfile inside
 * the program directory on purpose — suites enumerate and hash what the
 * compiler emitted there (tu-split counts .c files, deadstrip reads them),
 * and a marker inside would land in those sets.
 *
 * WHY A LOCK. The sweep may run in one worker while another worker is
 * acquiring, and the only harmful interleaving is "sweeper decided this is
 * done" followed by "acquirer started compiling into it" followed by
 * "sweeper deleted it". Both sides are therefore serialized per directory
 * by an exclusive-create lock file: the acquirer publishes state "held"
 * under it, and the sweeper re-reads the state under it and skips a
 * directory that was re-taken. Both critical sections are two file
 * operations long, so the lock is never contended for meaningfully; a lock
 * whose owning pid is gone is stolen.
 *
 * Every operation is best-effort in the direction that cannot lose data: a
 * lease that cannot be written means the directory is never reclaimed
 * in-run (it falls back to the cross-run rule), never that it is reclaimed
 * while in use.
 */
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { pidAlive } from "./run-registry.mjs";

/** Lease directory name, directly under the scratch root. */
export const LEASES_DIR = ".leases";

/** Longest a lock is waited for before proceeding anyway, in ms. Both
 * critical sections are two file operations, so reaching this means the
 * holder is wedged rather than working. */
const LOCK_WAIT_MS = 5000;

/** Names that are never a lease subject: a path segment must be one
 * component and must not be able to escape the scratch root. */
function badName(name) {
  return (
    typeof name !== "string" ||
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.startsWith(".") ||
    name.includes("/") ||
    name.includes("\\")
  );
}

function leaseDirOf(root) {
  return join(root, LEASES_DIR);
}
function leasePathOf(root, name) {
  return join(leaseDirOf(root), `${name}.json`);
}
function lockPathOf(root, name) {
  return join(leaseDirOf(root), `${name}.lock`);
}

/** Block this thread for `ms`. The lock is held for microseconds, so the
 * only caller is a spin that has already lost a race. */
function spinSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Take the per-directory lock. Returns true when held, false when it could
 * not be taken — and the two callers read that answer in OPPOSITE
 * directions on purpose: the sweeper treats false as "do not delete" and
 * the acquirer treats false as "proceed anyway", so a lock that cannot be
 * taken degrades to under-reclaiming rather than to deleting a live
 * directory.
 */
function lock(root, name) {
  const path = lockPathOf(root, name);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(leaseDirOf(root), { recursive: true });
      const fd = openSync(path, "wx");
      try {
        writeFileSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (err) {
      if (err === null || typeof err !== "object" || err.code !== "EEXIST") return false;
      /* Held. If the holder is gone it is a crashed run's leftover, and
       * leaving it would make this directory permanently unreclaimable. */
      let owner = null;
      try {
        owner = Number(readFileSync(path, "utf8"));
      } catch {
        /* torn or vanished: treat as stale */
      }
      if (owner === null || !Number.isInteger(owner) || owner <= 0 || !pidAlive(owner)) {
        try {
          rmSync(path, { force: true });
        } catch {
          /* someone else stole it first */
        }
        continue;
      }
      if (Date.now() >= deadline) return false;
      spinSleep(10);
    }
  }
}

function unlock(root, name) {
  try {
    rmSync(lockPathOf(root, name), { force: true });
  } catch {
    /* a stale lock is stolen by the next taker */
  }
}

function writeLease(root, name, rec) {
  try {
    mkdirSync(leaseDirOf(root), { recursive: true });
    writeFileSync(leasePathOf(root, name), JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}

/** The lease on `name`, or null when there is none (or it is unreadable —
 * which reads as "no lease", i.e. not reclaimable in-run). */
export function readLease(root, name) {
  if (badName(name)) return null;
  let rec;
  try {
    rec = JSON.parse(readFileSync(leasePathOf(root, name), "utf8"));
  } catch {
    return null;
  }
  if (rec === null || typeof rec !== "object") return null;
  if (typeof rec.pid !== "number") return null;
  if (rec.state !== "held" && rec.state !== "done") return null;
  return rec;
}

/**
 * Whether the run has FINISHED with `name`, given its lease.
 *
 * Two ways to be finished, and both are statements about a process rather
 * than about a clock:
 *   - the test that took it released it ("done"); or
 *   - the process that took it is gone, so whatever it was doing it is not
 *     doing it now. A crashed worker's directories are otherwise held for
 *     the rest of the run by a record nobody will ever update.
 * No lease at all is NOT "finished": an uninstrumented suite creates its
 * directory without one, and the safe reading of silence is that the
 * directory is in use. Those fall to the cross-run floor instead.
 */
export function leaseReleased(lease) {
  if (lease === null) return false;
  return lease.state === "done" || !pidAlive(lease.pid);
}

/** Bytes under `dir` and its newest mtime, in one walk. */
export function measureDir(dir) {
  let size = 0;
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { size, newest };
  }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      const sub = measureDir(p);
      size += sub.size;
      newest = Math.max(newest, sub.newest);
    } else {
      try {
        const s = statSync(p);
        size += s.size;
        newest = Math.max(newest, s.mtimeMs);
      } catch {
        /* vanished under us */
      }
    }
  }
  return { size, newest };
}

/** Directories this process currently holds, by scratch root. */
const held = new Map();

/**
 * Create `<root>/<name>` and record that this process is USING it, so the
 * sweep will not take it away. Returns the directory path, so a call site
 * replaces its `join` + `mkdirSync` pair with one call.
 *
 * The lease is published BEFORE the directory is created and under the
 * lock, which is what makes the acquisition safe against a sweep that has
 * already decided the directory is stale: the sweeper re-reads the state
 * under the same lock and finds "held".
 */
export function holdScratch(root, name) {
  const dir = join(root, name);
  if (badName(name)) {
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  const locked = lock(root, name);
  try {
    writeLease(root, name, { v: 1, pid: process.pid, state: "held", at: Date.now() });
  } finally {
    if (locked) unlock(root, name);
  }
  let set = held.get(root);
  if (set === undefined) {
    set = new Set();
    held.set(root, set);
  }
  set.add(name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Record that this process has finished with `<root>/<name>`, caching what
 * it measures so a later sweep does not have to walk the directory again.
 * Returns the bytes released.
 */
export function releaseScratch(root, name) {
  if (badName(name)) return 0;
  held.get(root)?.delete(name); // our hold is over either way
  const m = measureDir(join(root, name));
  const locked = lock(root, name);
  try {
    /* Only OUR hold may be released. A directory re-taken by someone else
     * between our use and our release is theirs now, and marking it done
     * would hand the sweep permission we do not have. */
    const cur = readLease(root, name);
    if (cur !== null && cur.state === "held" && cur.pid !== process.pid && pidAlive(cur.pid)) return 0;
    writeLease(root, name, {
      v: 1,
      pid: process.pid,
      state: "done",
      at: Date.now(),
      bytes: m.size,
      newest: m.newest,
    });
  } finally {
    if (locked) unlock(root, name);
  }
  return m.size;
}

/**
 * Release everything this process currently holds, across every root, and
 * return the total bytes. Called from the per-test hook: when a test ends,
 * every directory it took is finished by the argument at the top of this
 * file.
 */
export function releaseAllHeld() {
  let bytes = 0;
  for (const [root, set] of held) {
    for (const name of [...set]) bytes += releaseScratch(root, name);
  }
  return bytes;
}

/** Names this process is holding under `root` — the hook's view, for tests. */
export function heldNames(root) {
  return [...(held.get(root) ?? [])].sort();
}

/**
 * Delete `<root>/<name>` and its lease, under the lock, unless the
 * directory has been re-taken by a live process in the meantime. Returns
 * whether it was removed.
 *
 * This is the ONLY deleter, and it is the other half of holdScratch's
 * critical section: acquisition publishes "held" under the lock, removal
 * checks for "held" under the same lock, so the two cannot interleave into
 * a compile writing into a directory being deleted.
 *
 * ASYNC, and not as a matter of style. A sweep runs inside a worker's
 * afterEach, and one sweep of a full gate removed 1,899 program
 * directories in a single call: done with rmSync that is one unbroken
 * block of the worker's event loop, and vitest's worker RPC answers it
 * with "Timeout calling onTaskUpdate" -- an unhandled error that fails the
 * run with every test passing. Awaiting each removal hands the loop back
 * between directories. The lock is held across the await, which is
 * correct: it is a per-directory file lock and this is the only holder.
 */
export async function sweepRemove(root, name) {
  if (badName(name)) return false;
  const locked = lock(root, name);
  if (!locked) return false; // could not serialize: do not delete
  try {
    const cur = readLease(root, name);
    if (cur !== null && cur.state === "held" && pidAlive(cur.pid)) return false;
    await rm(join(root, name), { recursive: true, force: true });
    await rm(leasePathOf(root, name), { force: true });
    return true;
  } catch {
    return false;
  } finally {
    unlock(root, name);
  }
}

/**
 * Whether a worker should walk the tree now.
 *
 * TWO independent triggers, and the second is not a belt-and-braces
 * duplicate of the first — it is the one that makes reclamation a
 * function of the TREE rather than of what this worker happens to be
 * doing. `releasedBytes` is per worker and counts only what this worker
 * released, so a worker running an uninstrumented file releases nothing
 * and, on the bytes rule alone, never sweeps at all: measured on a real
 * gate, the corpus phase held the tree in a 3.0-5.2 GB band and the
 * non-corpus phase then let it climb to 6.6 GB with 2,939 released
 * directories (5.32 GB) lying evictable, because no live worker was
 * releasing anything.
 *
 * `capMb <= 0` disables the sweep entirely, matching pruneScratchOnce.
 */
export function sweepDue(releasedBytes, msSinceLastSweep, env = process.env) {
  const capMb = Number(env["SCRIPTC_TEST_SCRATCH_MAX_MB"] ?? "4096");
  if (!Number.isFinite(capMb) || capMb <= 0) return false;
  const checkBytes = Number(env["SCRIPTC_TEST_SCRATCH_CHECK_MB"] ?? "512") * 1024 * 1024;
  const checkMs = Number(env["SCRIPTC_TEST_SCRATCH_CHECK_S"] ?? "60") * 1000;
  return releasedBytes >= checkBytes || msSinceLastSweep >= checkMs;
}
