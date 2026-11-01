/* Corpus programs whose subject is POSIX signal delivery to THIS process:
 * `process.kill(process.pid, "SIGINT" | "SIGTERM")` followed by listeners.
 * On Windows, Node's process.kill of SIGINT/SIGTERM terminates the process
 * without running any JavaScript listener, so the Node oracle exits 1 where
 * the program's `// @exit` says 0 (CI 41275356835). There is no Windows
 * signal batch to compare, so the corpus shard suites (the differential and
 * the LLVM differential, which run on the Windows lanes) skip exactly these
 * programs when process.platform is win32, and every other platform runs
 * them. Keep this list to rows that are POSIX-shaped by construction.
 *
 * Dependency-free on purpose: the predicate is unit-checked under plain Node
 * (see the sigdrain report), with the platform passed in. */

const POSIX_SIGNAL_DELIVERY_ROWS: ReadonlySet<string> = new Set([
  "21200-signal-two-signals-tick-job-order.ts",
  "21201-signal-delivery-order-not-registry.ts",
  "21202-signal-two-listeners-then-second-signal.ts",
  "21203-signal-remove-listener-mid-emit.ts",
  "21204-signal-throw-in-first-delivery.ts",
  "21205-signal-tick-schedules-job-across-deliveries.ts",
  "21206-signal-same-twice-one-batch.ts",
  "21207-signal-two-listeners-one-emit.ts",
  "21208-signal-once-batch-then-rearm.ts",
]);

/** The skip note for a corpus program on this platform, or undefined to run it.
 * `rel` is the program's path under tests/corpus (the suites' own key). */
export function posixOnlySkipReason(
  rel: string,
  platform: NodeJS.Platform | string = process.platform,
): string | undefined {
  if (platform !== "win32") return undefined;
  if (!POSIX_SIGNAL_DELIVERY_ROWS.has(rel)) return undefined;
  return "posix-only: self-delivered SIGINT/SIGTERM runs no listener on Windows (Node terminates the process); skipped on win32";
}
