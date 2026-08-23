// The require shapes that ALREADY worked, pinned beside the ones that
// changed (5970). Widening `require` is exactly the kind of change that
// buys one shape by breaking four, and every line here is a shape the
// import-statement path, the builtin alias or the module-order walk owns —
// none of them should have moved a byte.
//
// Node runs this file directly; the compiled binary must print the same
// bytes. Nothing prints a path.
'use strict';

/* ── 1. a literal relative require IS an import: the dep's body runs at
 *      the require, exactly here, and the bindings alias its exports ── */
console.log('N1 before');
const dep = require('./dep.cjs');
console.log('N2 after', dep.n, dep.tag);

/* ── 2. and a second require of the same module runs nothing again ──── */
const dep2 = require('./dep.cjs');
console.log('N3 second', dep2.n, dep2.tag);

/* ── 3. a literal builtin require binds the namespace ───────────────── */
const path = require('path');
const os = require('os');
console.log('N4', path.basename('a/b/c.txt'), typeof os.platform());
console.log('N5', path.join('a', 'b') === 'a' + path.sep + 'b');

/* ── 4. the node: spelling of the same builtin ──────────────────────── */
const path2 = require('node:path');
console.log('N6', path2.extname('x.tar.gz'));

/* ── 5. a destructured builtin require ──────────────────────────────── */
const { basename, dirname } = require('node:path');
console.log('N7', basename('/x/y/z.js'), dirname('/x/y/z.js'));

/* ── 6. the CommonJS module globals are still what Node says they are.
 *      A vendored bundle's first act is the `typeof require` sniff, and an
 *      ES module must answer "undefined" to it — this file is CommonJS, so
 *      "function". (`typeof module`/`typeof exports` are left out on
 *      purpose: the reference to `module` as a VALUE has its own SC1090
 *      fence, unrelated to require and out of this file's scope.) */
console.log('N8', typeof require, typeof __dirname, typeof __filename);

/* ── 7. a LOCAL binding named `require` is not the module global, and
 *      shadowing it must not route through any of the above ─────────── */
function shadowed() {
  const require = function (x) { return 'local:' + x; };
  return require('no-such-pkg-xyz');
}
console.log('N9', shadowed());

/* ── 8. a PARAMETER named require, same rule ────────────────────────── */
function viaParam(require) { return require('anything'); }
console.log('N10', viaParam(function (x) { return 'param:' + x; }));

/* ── 9. require.main.filename is the ENTRY module's path: a real read
 *      under Node, a compile-time constant in a compiled program, and the
 *      same answer about THIS file either way. (Only the `.filename`
 *      chain folds — `require.main` as a value keeps its own SC2020, so
 *      the chain is spelled whole.) ──────────────────────────────────── */
console.log('N11', require.main.filename.endsWith('main.cjs'));

console.log('done');
