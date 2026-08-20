// @deferred-fences: 1
// A program that carries, on purpose, one instance of each population
// scripts/tu-census.mjs counts — and runs exactly like Node anyway, because
// every one of them sits on a path this program never takes.
//
// It exists so the census has a fixture that BOTH lanes can be pointed at.
// The compiler's release default is the LLVM lane (index.ts emits the .ll
// first and falls back to C only on a tier refusal), and the census used to
// take `<tu.c>` only; a program whose emitted TU carries a known population is
// the thing the two readers have to agree about. The counts themselves are
// asserted in packages/compiler/test/tu-census-lanes.test.ts, which compiles
// this file twice and censuses both TUs.
//
// What is planted, and where the census puts it:
//
//   REFUSAL   the `new Proxy(...)` wrap. `globalThis['__scriptc_absent__']`
//             answers undefined in a static build, so the arm folds away at
//             run time and the fence is never executed — which is why this
//             file still passes the differential oracle. It is the ONE
//             deferred fence the header declares.
//   BOILER-   `classify`'s fall-through. tsc proves every path returns and the
//   PLATE     lowering cannot, so an SC9002 guard is emitted after the switch.
//             Not a refusal: the guard is unreachable by construction.
//   ABORT.    the record literals below allocate, and every raw allocation in
//   structural an emitted TU is followed by its OOM guard.
//
// Nothing here is dead code the optimiser can drop: every value printed below
// is computed from one of them.
'use strict';

function classify(v) {
  switch (typeof v) {
    case 'string':
      return 's';
    case 'number':
      return 'n';
    default:
      return 'o';
  }
}

function readKey(bag) {
  if (globalThis['__scriptc_absent__'] !== undefined) {
    return new Proxy(bag, {}).k; // untaken: dynamic-global probes answer undefined
  }
  return bag.k;
}

const first = { k: 'alpha' };
const second = { k: 'beta' };

console.log('C1', classify('a') + classify(1) + classify(null) + classify(true));
console.log('C2', readKey(first) + '/' + readKey(second));
console.log('C3', [first, second].map(function (b) { return classify(readKey(b)); }).join(''));
