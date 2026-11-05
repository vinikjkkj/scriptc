import { totalmem } from "node:os";
import { getHeapStatistics } from "node:v8";
import { Worker } from "node:worker_threads";

// A large program (a driver, the REST service over zapo) keeps more than node's default old-space ceiling (about 4 GB on a
// 16 GB machine) alive while it is lowered and emitted, and the build died with "heap out of memory" after more than an hour.
// V8 cannot raise the ceiling of a running isolate (v8.setFlagsFromString('--max-old-space-size') changes nothing), but a worker
// thread is created with its own ceiling. When the machine can give more than the default, the entry runs the CLI in one worker
// with a ceiling sized to the machine: one thread, no second process, no second runtime boot.

export function heapCeilingMB(totalBytes: number): number {
  return Math.min(Math.floor((totalBytes / 1048576) * 0.75), 32768);
}

/** The ceiling to run with, or 0 when this isolate already has what the machine can give (or the caller chose one). */
export function wantedCeilingMB(totalBytes: number, haveBytes: number, execArgv: readonly string[]): number {
  if (execArgv.some((a) => a.startsWith("--max-old-space-size"))) return 0;
  const want = heapCeilingMB(totalBytes);
  const have = Math.floor(haveBytes / 1048576);
  return want > have + have / 8 ? want : 0;
}

/** Runs `entry` (an absolute file URL) with the raised ceiling in a worker; returns false when none is needed. */
export function runWithCeiling(entry: URL): boolean {
  const want = wantedCeilingMB(totalmem(), getHeapStatistics().heap_size_limit, process.execArgv);
  if (want === 0) return false;
  const worker = new Worker(entry, {
    argv: process.argv.slice(2),
    resourceLimits: { maxOldGenerationSizeMb: want },
  });
  worker.on("error", (err) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  });
  worker.on("exit", (code) => {
    if (process.exitCode === undefined) process.exitCode = code;
  });
  return true;
}
