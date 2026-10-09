/* LRU sweep over the harness's SCRATCH tree.
 *
 * Two content-addressed trees back a gate run and only one of them was ever
 * bounded. `SCRIPTC_CACHE_DIR` (cc.ts's bin/ + obj/ + the oracle records) has
 * had a size-capped LRU sweep since it landed. The other one —
 * node_modules/.cache/scriptc-tests/<key>/, where every corpus suite writes
 * the emitted .c/.ll and the executable it is about to run — has never been
 * swept by anything. Measured on this tree: ~12 GB per full gate, and it
 * survives the run, the next run, and every run after it. On Windows 56% of
 * it is the .pdb lld-link drops beside each binary.
 *
 * The .pdb is NOT dead weight and must not be suppressed at the link line:
 * tests/perf/exe-profile.mjs and tests/perf/cpuphase symbolise offline from
 * exactly that file, beside exactly that binary. Bounding the tree by
 * liveness and size leaves them where the profiler expects them and still
 * returns the disk — which is the same trade cc.ts already made for the CAS.
 *
 * The rules are pruneCacheOnce's, deliberately, because they were argued
 * once already:
 *   - a SIZE CAP, not a lifetime: under it, nothing is touched at all;
 *   - a LIVENESS FLOOR, so nothing a live run (or the other flavor's
 *     concurrent run — the suite lock is per flavor by design) may still
 *     be holding can be taken out from under it;
 *   - eviction stops at 75% of the cap, so a run is not re-sweeping on
 *     every invocation.
 *
 * That middle rule used to read "an AGE FLOOR of one hour", and the hour
 * was a proxy for "in use" that is wrong in both directions — see
 * run-registry.mjs, which now answers the question from process liveness
 * instead. The consequence the proxy had in practice: a gate relaunched
 * after a dead one (the common case) protected every byte the dead run had
 * written and recovered NOTHING, which is how a tree measured at 11.46 GB
 * stayed there across a relaunch while the new gate died with 2.26 GB free.
 * When no run is alive there is now no floor at all, so a relaunch recovers
 * the full overage immediately.
 *
 * WHAT THE FLOOR CANNOT DO, AND WHAT THE LEASE ADDS. The floor bounds the
 * tree BETWEEN runs and is silent WITHIN one, because a run's own
 * directories are all newer than its own start: during a full gate the only
 * live pid is the gate itself, the floor correctly spares everything, and
 * the tree runs to 16 GB with nothing able to reclaim it. `pnpm test` had
 * to be run in chunks on this host for exactly that reason. So a second,
 * finer fact is recorded — scratch-lease.mjs — saying which directories the
 * run has FINISHED with, and a released lease is evictable whatever the
 * floor says. The argument for that is a test's completion, not an mtime:
 * see scratch-lease.mjs's head. A directory with NO lease is never
 * in-run-evictable, so an uninstrumented suite under-reclaims rather than
 * loses a directory it is using.
 *
 * WHAT IS A CANDIDATE. Everything under the root except the CAS and the
 * sweep's own bookkeeping. The rule used to be a 16-hex name — what
 * compileAndRun/build() create per program — on the grounds that a named
 * directory "is the kind of thing a suite may be holding a path to across
 * its whole file", and that the rest were small. Neither half survived
 * measurement: 542 name-prefixed directories (`server-<key>`, `npm-<key>`,
 * `fetch-<key>` and friends — per-program directories that merely spell
 * their key with a prefix) held 2.63 GB, 38% of the tree, and could never
 * be evicted by anything. And "a suite may be holding a path" is the
 * question liveness and the lease now answer directly, for named and
 * hex-named directories alike. The one directory that stays out is `cas`:
 * SCRIPTC_CACHE_DIR's default location is inside this tree, it IS a build
 * input, and it has its own size-capped sweep. It is excluded from the
 * total as well as from eviction — counting a separately-bounded cache
 * against this cap would make the cap unreachable.
 *
 * Eviction is CHEAP here in a way it is not for the CAS, which is why the
 * default cap is tight: the executable in a program directory is a COPY of
 * the one in SCRIPTC_CACHE_DIR/bin, and the .c beside it is rewritten by
 * every compile. Evicting a program directory therefore costs the next run
 * one copyFile, not one zig cc -- the binary cache still answers. Nothing
 * here is a build input.
 *
 * Every error is swallowed: a sweep is never allowed to fail a gate.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { scratchFloor } from "./run-registry.mjs";
import { leaseReleased, readLease, sweepRemove } from "./scratch-lease.mjs";

/** The CAS: a build input with its own cap, and not this sweep's business. */
export const CAS_DIR = "cas";

/** Bytes under `dir`, and its newest mtime. Both in one walk.
 *
 * A DIRECTORY WITH NO FILE UNDER IT IS DATED BY ITSELF, and that fallback is
 * load-bearing rather than tidy. `newest` starts at 0 -- the EPOCH -- and only
 * file mtimes raise it, so a directory holding no file anywhere beneath it
 * reports as the oldest thing in the tree: it sorts FIRST in the eviction
 * order below AND fails every `newest > floor` test, which is the floor's
 * entire mechanism for sparing what a live run may hold. The two failures
 * compound -- such a directory is not merely evictable, it is the first
 * candidate taken.
 *
 * THE WINDOW IS NOT THEORETICAL. A suite that calls mkdirSync on its outDir
 * and then starts a compile owns an empty directory for as long as that
 * compile takes to write its first byte. Measured 2026-10-09, shard 6 of a
 * merge gate: an in-run sweep in another worker deleted
 * `microtask-turns-<key>` while the c-backend test was inside compile(), and
 * it surfaced as ENOENT on the emitted turns.c -- a red that names a
 * behavioural test and is not one.
 *
 * ONLY THE NO-FILE CASE FALLS BACK, deliberately. Folding the directory's own
 * mtime into `newest` unconditionally would re-date every program directory
 * to whenever its last entry was added, which is not when its contents were
 * written and would destroy the LRU order the cap test pins. */
async function measure(dir) {
  let size = 0;
  let newest = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      const sub = await measure(p);
      size += sub.size;
      newest = Math.max(newest, sub.newest);
    } else {
      const s = await stat(p).catch(() => null);
      if (s !== null) {
        size += s.size;
        newest = Math.max(newest, s.mtimeMs);
      }
    }
  }
  // No file anywhere beneath: the walk has no evidence of age, and 0 is not
  // "unknown", it is the epoch. Date the directory by itself so the floor can
  // see how recent it really is.
  if (newest === 0) {
    const s = await stat(dir).catch(() => null);
    if (s !== null) newest = s.mtimeMs;
  }
  return { size, newest };
}

/**
 * Sweep `root` down to `SCRIPTC_TEST_SCRATCH_MAX_MB` (default 4096).
 * Returns what it did, so a test can assert it both evicts AND spares —
 * a sweep that silently evicted nothing would make every guard pass for
 * the wrong reason.
 *
 * `opts.floor` overrides the liveness floor (see run-registry.mjs): a
 * number protects everything newer, `null` protects nothing. Tests pass it
 * so they can state a liveness situation directly instead of having to
 * spawn a process to stand for one; production leaves it undefined and the
 * registry answers. `opts.selfPid` is which run is "us" — the one run
 * whose record must NOT hold the floor up, since at sweep time (globalSetup,
 * before any worker starts) we are holding nothing.
 */
export async function pruneScratchOnce(root, now = Date.now(), opts = {}) {
  const capBytes = Number(process.env["SCRIPTC_TEST_SCRATCH_MAX_MB"] ?? "4096") * 1024 * 1024;
  const result = { total: 0, freed: 0, evicted: [], spared: 0 };
  if (!Number.isFinite(capBytes) || capBytes <= 0) return result;

  const entries = await readdir(root, { withFileTypes: true }).catch(() => null);
  if (entries === null) return result; // no scratch tree yet: nothing to do

  const dirs = [];
  /* The scan is mostly sync work -- one small JSON read per released
   * directory -- and on a full gate's tree that is several thousand of
   * them inside a worker's afterEach. Hand the event loop back
   * periodically or vitest's worker RPC times out while every test
   * passes; see sweepRemove's note. */
  let scanned = 0;
  for (const ent of entries) {
    if (++scanned % 200 === 0) await new Promise((r) => setImmediate(r));
    // The run registry, the lease sidecar, and anything else dot-prefixed
    // is bookkeeping, not scratch: not a candidate, and counting it as
    // "spared" would report it as program data the sweep chose to keep.
    if (ent.name.startsWith(".")) continue;
    const p = join(root, ent.name);
    if (ent.isDirectory()) {
      // The CAS is out of scope in both directions — see the head note.
      if (ent.name === CAS_DIR) {
        result.spared++;
        continue;
      }
      const lease = readLease(root, ent.name);
      const released = leaseReleased(lease);
      /* A released lease cached what it measured at release time, and
       * nothing has written to the directory since — that is what released
       * means. Re-walking every program directory on every sweep is the
       * cost that would otherwise make an in-run sweep too expensive to
       * run often enough to matter. */
      const m =
        released && typeof lease.bytes === "number" && typeof lease.newest === "number"
          ? { size: lease.bytes, newest: lease.newest }
          : await measure(p);
      result.total += m.size;
      dirs.push({ name: ent.name, path: p, released, ...m });
    } else {
      const s = await stat(p).catch(() => null);
      if (s !== null) result.total += s.size;
    }
  }
  if (result.total <= capBytes) return result;

  /* Never evict what a live run may hold — asked of the process table, not
   * of the clock. `null` means nothing is alive over this tree, and then
   * nothing is protected: LRU order alone decides. */
  const floor =
    opts.floor !== undefined ? opts.floor : scratchFloor(root, now, opts.selfPid ?? process.pid);
  let total = result.total;
  for (const d of dirs.sort((a, b) => a.newest - b.newest)) {
    if (total <= capBytes * 0.75) break;
    /* Two independent licences to evict, and the second is what makes an
     * IN-RUN sweep possible at all:
     *   - the directory predates every live run, so no live run can be
     *     holding it (run-registry.mjs's argument); or
     *   - the test that took it has released it, whatever its mtime
     *     (scratch-lease.mjs's argument).
     * Not a `break` on the floor test any more: released leases are
     * interleaved with protected directories in mtime order, so passing
     * over one must not end the scan. */
    if (!d.released && floor !== null && d.newest > floor) continue;
    if (!(await sweepRemove(root, d.name))) continue; // re-taken under the lock
    total -= d.size;
    result.freed += d.size;
    result.evicted.push(d.name);
  }
  return result;
}

