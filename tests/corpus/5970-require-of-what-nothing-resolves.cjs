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

/* ── 3. a constant ONE BINDING AWAY is the same require — BOTH
 *      spellings, which reach the answer by different roads. `const`
 *      gives the checker a string LITERAL type, so the specifier is
 *      known at COMPILE time and the verdict is decided there; `var`
 *      widens to `string`, so nothing is known and the same answer comes
 *      out of the RUN-TIME verdict instead. One of them alone leaves half
 *      the machinery unproven. ────────────────────────────────────────── */
const CONST_NAME = 'no-such-pkg-xyz';
var VAR_NAME = 'no-such-pkg-xyz';
try {
  var m3 = require(CONST_NAME);
  console.log('L3 GOT', typeof m3);
} catch (e) {
  console.log('L3', e.code, '|', firstLine(e.message));
}
try {
  var m3b = require(VAR_NAME);
  console.log('L3b GOT', typeof m3b);
} catch (e) {
  console.log('L3b', e.code, '|', firstLine(e.message));
}

/* ── 4. a genuine RUN-TIME specifier, through a parameter ───────────── */
function tryRequire(spec) {
  try {
    var mod = require(spec);
    return 'GOT ' + typeof mod;
  } catch (e) {
    return e.code + ' | ' + firstLine(e.message);
  }
}
console.log('L4', tryRequire('no-such-pkg-xyz'));
console.log('L5', tryRequire('@nope/nothing'));
console.log('L6', tryRequire('@nope/nothing/deeper'));

/* ── 5. a name that merely LOOKS like an installed one. Neither a prefix
 *      of an installed package nor a name one is a prefix of resolves —
 *      and the corpus directory really does sit under a node_modules
 *      chain, so this is not a vacuous test. ─────────────────────────── */
console.log('L7', tryRequire('vites'));
console.log('L8', tryRequire('vitestxyz'));

/* ── 6. Node validates the id BEFORE resolving anything ─────────────── */
function tryArg(x) {
  try {
    require(x);
    return 'GOT';
  } catch (e) {
    return e.code + ' | ' + e.message;
  }
}
console.log('L9', tryArg(42));
console.log('L10', tryArg(null));
console.log('L11', tryArg(undefined));
console.log('L12', tryArg(''));
console.log('L13', tryArg(true));

/* ── 7. the specifier EXPRESSION runs first — the throw must not be
 *      hoisted over the argument's side effects ─────────────────────── */
var ran = 0;
function spec() { ran = ran + 1; console.log('L14 spec ran', ran); return 'no-such-pkg-xyz'; }
try { require(spec()); } catch (e) { console.log('L15', e.code, 'ran', ran); }

/* ── 8. protobufjs's inquire(), verbatim. The `typeof require` guard
 *      opens it because a bundle may be loaded as ESM, where Node defines
 *      no require at all; here it is CommonJS, so the guard passes and
 *      the require runs. ─────────────────────────────────────────────── */
function inquire(moduleName) {
  try {
    if (typeof require !== 'function') return null;
    var mod = require(moduleName);
    return mod && (mod.length || Object.keys(mod).length) ? mod : null;
  } catch (e) { /* Node's MODULE_NOT_FOUND — protobufjs swallows it */ }
  return null;
}
console.log('L16', typeof require);
console.log('L17', String(inquire('long')));
console.log('L18', String(inquire('no-such-pkg-xyz')));

/* ── 9. the SAME require, twice: a failed resolution is not cached into
 *      a different answer ─────────────────────────────────────────────── */
console.log('L19', tryRequire('no-such-pkg-xyz') === tryRequire('no-such-pkg-xyz'));

console.log('done');
