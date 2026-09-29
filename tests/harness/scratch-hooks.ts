/* The IN-RUN half of the scratch bound, installed in every worker.
 *
 * prune-scratch.mjs runs once at globalSetup, with the lock held and
 * before any worker exists, and that is the only moment its floor can
 * reclaim anything: from then on every directory the gate writes is newer
 * than the gate's own start, so the floor spares all of it and the tree
 * runs past 16 GB. A full `pnpm test` did not fit on this host for that
 * reason and had to be driven in chunks with a purge between them.
 *
 * What this file adds is the other end of the lease: a test that has ended
 * is finished with every scratch directory it took (scratch-lease.mjs's
 * head argues why), so `afterEach` releases them, and once enough has been
 * released to be worth a walk the sweep runs again — in the worker, mid
 * run, reclaiming what the run itself has finished with.
 *
 * NOT GATED ON THE FULL-SUITE LOCK, deliberately, and it is the one
 * difference from the globalSetup sweep. That sweep is inside
 * suite-lock.mjs's acquired branch because it is a whole-tree operation at
 * a moment chosen for being quiet. This one only ever removes directories
 * whose own lease says the test that took them is done, which is as true
 * in a filtered single-file run as in a full gate — and a filtered run
 * that cannot reclaim is exactly how the tree fills while the bound looks
 * like it is working.
 *
 * AMORTIZED, not per test: a sweep walks the unleased part of the tree,
 * and doing that after every one of ~1,200 corpus tests would cost more
 * than it returns. It runs once per SCRIPTC_TEST_SCRATCH_CHECK_MB (default
 * 512) of released scratch. Setting that to 0 sweeps after every test —
 * what the harness's own tests want, and what makes an instrumented gate
 * report every step.
 *
 * AND ON A TIMER, which is not redundant with the byte trigger and was
 * measured to be the difference between a bounded gate and an unbounded
 * one. The byte counter is per WORKER and counts only what that worker
 * released, so a worker running an UNINSTRUMENTED file releases nothing
 * and never sweeps — however much finished scratch other workers have
 * left lying evictable. On the first full-gate run of this change the
 * corpus phase held the tree in a 3.0-5.2 GB band and then the non-corpus
 * phase let it climb to 6.6 GB with 2,939 released directories (5.32 GB)
 * sitting there, because no live worker was releasing anything. So every
 * worker also sweeps once per SCRIPTC_TEST_SCRATCH_CHECK_S (default 60),
 * which makes reclamation depend on the tree's state rather than on what
 * the worker that happens to be running is doing.
 *
 * SCRIPTC_NO_SCRATCH_SWEEP=1 turns the whole thing off, for measuring what
 * the tree would have grown to.
 */
import { join } from "node:path";
import { afterEach } from "vitest";
import { pruneScratchOnce } from "./prune-scratch.mjs";
import { releaseAllHeld, sweepDue } from "./scratch-lease.mjs";

const SCRATCH_ROOT = join(import.meta.dirname, "../../node_modules/.cache/scriptc-tests");

const GB = 1024 ** 3;
const enabled = process.env["SCRIPTC_NO_SCRATCH_SWEEP"] !== "1";

/** Bytes released since the last sweep, in THIS worker. */
let sinceSweep = 0;
/** When this worker last swept. Never having swept must not be a reason
 * to wait, so the clock starts at the worker's own start. */
let lastSweep = Date.now();

afterEach(async () => {
  if (!enabled) return;
  sinceSweep += releaseAllHeld();
  if (!sweepDue(sinceSweep, Date.now() - lastSweep)) return;
  sinceSweep = 0;
  lastSweep = Date.now();
  try {
    const swept = await pruneScratchOnce(SCRATCH_ROOT);
    if (swept.freed > 0) {
      console.log(
        `[scriptc] scratch sweep (in run, pid ${process.pid}): ` +
          `${(swept.total / GB).toFixed(2)} GB -> ${((swept.total - swept.freed) / GB).toFixed(2)} GB, ` +
          `freed ${(swept.freed / GB).toFixed(2)} GB from ${swept.evicted.length} finished program directories`,
      );
    }
  } catch {
    /* a sweep is never a test failure */
  }
});
