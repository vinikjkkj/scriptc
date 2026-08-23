// Package SELF-REFERENCE, and the two rules Node applies to it.
//
// A compiled binary reads no node_modules at run time, so a run-time
// `require(x)` decides its verdict from a set of resolvable bare roots
// the BUILD baked in. That set walked every ancestor package.json and
// added its "name", which is neither of Node's rules:
//
//   1. a package scope with no "exports" field self-references NOTHING —
//      its own name answers MODULE_NOT_FOUND from inside it;
//   2. only the NEAREST enclosing package.json is a file's scope — an
//      OUTER package's name asked from inside a nested one answers
//      MODULE_NOT_FOUND even when the outer HAS "exports".
//
// Over-adding is the loud direction, so nothing here was ever a wrong
// VALUE — but it is a refusal the program need not carry, and under
// --best-effort (which zapo builds with) that refusal is a deferred
// [SCxxxx] throw inside a `try { require(x) } catch`, i.e. a caught trap
// where Node has a plain catchable MODULE_NOT_FOUND.
//
// MEASURED ON BOTH BACKENDS BEFORE THE FIX: this program does not
// COMPILE. Every line below refused
//   SC2020 'require() with a run-time specifier' ... has no scriptc
//   lowering yet
// because the baked root set claimed the specifier was resolvable.
//
// The specifiers are `var`-bound on purpose: `const` gives the checker a
// string LITERAL type and the answer comes from the compile-time fold
// instead of the baked set, so a `const` spelling would test a different
// road to the same output and prove nothing about this one.
//
// The over-fire control is lines 4 and 5: a compiler that answered
// MODULE_NOT_FOUND for every require would pass lines 1-3 and fail these,
// because Node checks the ARGUMENT before it resolves anything. The
// complementary control — that self-reference is not simply DROPPED, so a
// scope WITH "exports" still resolves its own name — cannot live in a
// corpus program, because the value it would have to hand back is a
// module namespace object a compiled program has no representation for;
// it is pinned in packages/compiler/test/require-resolution-base.test.ts.
'use strict';

// The nested scope is reached through a TOP-LEVEL BINDING require: a
// relative require consumed as a VALUE is the module-namespace-as-a-value
// fence, a different refusal from the one this entry is about, and in a
// JavaScript source it defers into the translation unit rather than
// failing the build.
const inner = require('./inner/t.cjs');

var own = 'corpus-selfref-scope';
try { require(own); console.log('1', 'no throw'); }
catch (e) { console.log('1', e.code, String(e.message).split('\n')[0]); }

var sub = 'corpus-selfref-scope/inner';
try { require(sub); console.log('2', 'no throw'); }
catch (e) { console.log('2', e.code, String(e.message).split('\n')[0]); }

console.log('3', inner.report);

try { require(42); console.log('4', 'no throw'); } catch (e) { console.log('4', e.code); }
try { require(''); console.log('5', 'no throw'); } catch (e) { console.log('5', e.code); }
