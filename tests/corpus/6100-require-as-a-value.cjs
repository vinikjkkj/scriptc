// `require` NOT called: the ambient CommonJS require held as a VALUE.
//
// MEASURED ON BOTH BACKENDS BEFORE THE FIX, every `typeof` line below
// printed `string` and the guard line printed `absent` — because in a
// JavaScript source a stdlib global taken as a bare value became the
// interned identity TOKEN `"[builtin require]"`. Exit 0, no diagnostic,
// no [SCxxxx]: a WRONG answer, which this project ranks below a refusal.
// The guard line is protobufjs's own `inquire()` test one binding away
// (`if ("function" != typeof require) return null`), so a bundle that
// aliased require before testing it was told the require it holds does
// not work.
//
// Calling THROUGH the value is the same require as calling it directly:
// the lifted body IS the run-time-specifier arm, so a specifier the build
// ruled out reaches Node's catchable MODULE_NOT_FOUND and Node's argument
// errors come out ahead of any resolution. Nothing here prints a path —
// MODULE_NOT_FOUND's message carries the requiring file on its second
// line, so the code and a path-free test of the first line are all that
// is printed.
'use strict';

const r = require;
const arr = [require];
const obj = { q: require };

console.log('1', typeof require, typeof r, typeof arr[0], typeof obj.q);

// protobufjs inquire()'s own guard, one binding away.
console.log('2', 'function' === typeof r ? 'usable' : 'absent');

// Identity: one interned value per program, so the alias IS require.
console.log('3', require === r);

// A specifier NOTHING installed resolves, reached through the value.
try {
  r('no-such-pkg-xyz');
  console.log('4', 'no throw');
} catch (e) {
  console.log('4', e.code, /^Cannot find module 'no-such-pkg-xyz'$/.test(String(e.message).split('\n')[0]));
}

// Node checks the ARGUMENT before it resolves anything.
try { r(42); console.log('5', 'no throw'); } catch (e) { console.log('5', e.code); }
try { r(''); console.log('6', 'no throw'); } catch (e) { console.log('6', e.code); }

// The value handed to a function and called there.
function use(f) {
  try { return f('no-such-pkg-xyz'); } catch (e) { return 'caught ' + e.code; }
}
console.log('7', use(require));

// A LOCAL binding of the same name is not the module global — the
// over-fire control for every line above.
function shadowed(require) { return typeof require; }
console.log('8', shadowed(7), shadowed('x'));
