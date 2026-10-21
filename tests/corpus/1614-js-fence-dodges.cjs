// Constructs a JS program may carry on paths it never takes. The dual-mode
// number/bigint helper is the shape that matters: `typeof ms === 'bigint'`
// folds constant-false over a checked-dynamic parameter (no dyn box holds
// a bigint), so the bigint arm — whose literals have no lowering — folds
// away and the number path runs (the record read `multipliers.two`
// compiles). A construct with no static lowering is a COMPILE error, never
// a fence that waits for the path to run: the `new Proxy` wrap that used to
// sit in the untaken branch of platformScale is pinned as a refusal by
// tests/diagnostics/js-new-proxy.js.
'use strict';

function platformScale(ms) {
  const multipliers = typeof ms === 'bigint' ? { two: 2n, four: 4n } : { two: 2, four: 4 };
  if (globalThis['__scriptc_absent__'] !== undefined) {
    return multipliers.two * ms; // untaken: dynamic-global probes answer undefined
  }
  return ms;
}
console.log('F1', platformScale(4000) === 4000);

// Identity tokens: stdlib global function values participate in identity
// flows (the harness's knownGlobals idiom) — one global, one token.
const known = new Set([setTimeout, clearTimeout, setInterval]);
console.log('F2', known.has(setTimeout), known.has(clearInterval));

// WeakMap constructs as an opaque value; its methods live behind fences
// that never fire here.
const wm = new WeakMap();
console.log('F3', wm !== null);

// for-in over globalThis: nothing a compiled program can leak — the body
// observes no scriptc-created enumerable globals (Node's own baseline
// names are all outside this program's output).
let sawOwnLeak = false;
for (const k in globalThis) {
  if (k === '__scriptc_leak__') sawOwnLeak = true;
}
console.log('F4', sawOwnLeak);
