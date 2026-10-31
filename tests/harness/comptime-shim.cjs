/* The Node-side comptime oracle. Under plain JS semantics `comptime(fn)` is
 * just `fn()` — evaluate now — so defining it globally lets Node remain the
 * differential oracle for comptime corpus programs: the value scriptc bakes
 * at COMPILE time must be byte-identical to what Node computes at RUN time.
 * Loaded via `--require` for every corpus run; inert for programs that never
 * mention comptime. */
globalThis.comptime = (f) => f();
