// `require` of a specifier NOTHING INSTALLED resolves — Node throws
// MODULE_NOT_FOUND at the require site, catchably, and that is the whole
// optional-dependency idiom every vendored bundle ships.
//
// MEASURED ON BOTH BACKENDS BEFORE THE FIX, this file's first section
// printed `code SC1090 | require() with bindings outside the module's top
// level (move it to the top of the file)` and its third printed
// `code SC2011 | values of type '{ (id: string): any; ... }' have no static
// representation ...` — a COMPILER REFUSAL, deferred into the translation
// unit by the JS-input stance, swallowed by the program's own catch, at
// exit 0. Anything reading `e.code === 'MODULE_NOT_FOUND'` took the wrong
// branch; anything counting on the module being absent got the right
// answer for a reason that would have been wrong the moment it existed.
//
// Nothing here prints a path: MODULE_NOT_FOUND's message carries the
// requiring file on its second line, so every case prints `e.code` and the
// FIRST line of the message only.
'use strict';

function firstLine(s) { return String(s).split('\n')[0]; }

/* ── 1. the written literal, with a binding, inside the program's try ── */
try {
  var m1 = require('no-such-pkg-xyz');
  console.log('L1 GOT', typeof m1);
} catch (e) {
  console.log('L1', e.code, '|', firstLine(e.message));
}

/* ── 2. the bare side-effect form (its message was right, its code was
 *      `undefined` — and the code is the property the idiom reads) ───── */
try {
  require('no-such-pkg-xyz');
  console.log('L2 GOT');
} catch (e) {
  console.log('L2', e.code, '|', firstLine(e.message));
}

/* ── 3. a constant ONE BINDING AWAY is the same require. `const` gives the
 *      checker a string LITERAL type, so the specifier is known at COMPILE
 *      time and the verdict is decided there. (A `var` widens to `string`:
 *      nothing is known at build time, which makes it a run-time-specifier
 *      require, and that is a compile refusal — see
 *      tests/diagnostics/js-require-with-a-run-time-specifier.cjs.) ──────── */
const CONST_NAME = 'no-such-pkg-xyz';
try {
  var m3 = require(CONST_NAME);
  console.log('L3 GOT', typeof m3);
} catch (e) {
  console.log('L3', e.code, '|', firstLine(e.message));
}

console.log('done');
