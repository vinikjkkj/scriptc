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
 * Only CONTENT-KEY directories are evictable: a 16-hex-character name is
 * what compileAndRun/build() create per program, and it is where the whole
 * 12 GB lives. Everything else under the root (a suite's named fixture
 * directory, the dec-oracle-*.mjs files, cli-flush) is left alone — those
 * are small, and a named directory is the kind of thing a suite may be
 * holding a path to across its whole file.
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
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { scratchFloor } from "./run-registry.mjs";

const KEY_DIR = /^[0-9a-f]{16}$/;

/** Bytes under `dir`, and its newest mtime. Both in one walk. */
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
  for (const ent of entries) {
    // The run registry (and anything else dot-prefixed) is bookkeeping, not
    // scratch: it is not a candidate, and counting it as "spared" would
    // report it as program data the sweep chose to keep.
    if (ent.name.startsWith(".")) continue;
    const p = join(root, ent.name);
    if (ent.isDirectory()) {
      const m = await measure(p);
      result.total += m.size;
      if (KEY_DIR.test(ent.name)) dirs.push({ name: ent.name, path: p, ...m });
      else result.spared++;
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
    if (floor !== null && d.newest > floor) break; // sorted: the rest are newer too
    await rm(d.path, { recursive: true, force: true }).catch(() => undefined);
    total -= d.size;
    result.freed += d.size;
    result.evicted.push(d.name);
  }
  return result;
}
