/* Hand the worker's event loop a real turn before every test.
 *
 * vitest's worker talks to the main process over birpc, and every
 * onTaskUpdate it sends arms a 60 s timer (birpc's default; vitest 3.2
 * exposes no knob for it). The timer is cleared only when the main
 * process's acknowledgement is READ from the IPC channel. A test body that
 * blocks the worker synchronously -- cc.ts's execFileSync compile, a
 * spawnSync run of a built binary -- stops that read, so when the block
 * ends the timers phase runs before the acknowledgement is processed and
 * the 60 s timer fires: "[vitest-worker]: Timeout calling onTaskUpdate".
 * Every test still passes, but vitest records an unhandled error and exits
 * 1. On Windows the blocking waits run 100-700 s per file under load
 * (ci-classes.md F9), so the window is hit there.
 *
 * Reproduced on Linux (lab, 2026-10-24): a 75 s execFileSync in a test
 * body gives exactly that error with two green tests and exit 1; the same
 * body with this yield gives exit 0. setImmediate is NOT enough (the
 * acknowledgement needs a few ms of main-process work, and a check-phase
 * turn does not wait for it); 10 ms passed, 100 ms is used for margin
 * under load. The yield is a timing bound, not a proof: the complete cure
 * is to make the blocking waits asynchronous. */
import { beforeEach } from "vitest";

/** Long enough for the main process to answer the previous task update. */
const RPC_SETTLE_MS = 100;

beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, RPC_SETTLE_MS));
});
