/* A production-inert timing tap.
 *
 * The commit gate's cost has never been decomposed: "50 minutes" is one
 * number over ~6,500 tests that each pay a frontend, a codegen, possibly a
 * `zig cc`, a native run and a Node oracle spawn. Nothing in the tree could
 * say which of those the money goes to.
 *
 * The tap is a single optional-property read when nothing is listening
 * (`globalThis.__scrPhaseTap` is undefined in every production build and in
 * every test run that did not ask for it), so it can sit on the hot path of
 * `compile()` without being a cost of its own. A listener is installed only
 * by tests/harness/phase-collect.ts, which vitest loads via setupFiles when
 * SCRIPTC_PHASE_LOG names a directory.
 */
export type PhaseTap = (name: string, ms: number) => void;

function tapOf(): PhaseTap | undefined {
  return (globalThis as { __scrPhaseTap?: PhaseTap }).__scrPhaseTap;
}

/** Report `ms` spent in `name` to the listener, if any. */
export function tapPhase(name: string, ms: number): void {
  tapOf()?.(name, ms);
}

/** Time a synchronous stage. Identity (no clock read at all) when unlistened. */
export function tapped<T>(name: string, fn: () => T): T {
  const tap = tapOf();
  if (tap === undefined) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    tap(name, performance.now() - t0);
  }
}

/** Time an asynchronous stage. Identity when unlistened. */
export async function tappedAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const tap = tapOf();
  if (tap === undefined) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    tap(name, performance.now() - t0);
  }
}
