// `require.main?.filename` with a METHOD or a property TAIL after it — the
// entry-module identity read in the shape a harness actually writes.
//
// The fold itself has been right since 1629: in a compiled binary
// require.main IS the entry module, so the optional link cannot
// short-circuit and the read is the entry file's path, a compile-time
// string. lowerStringMethodCall even carries a gate written for exactly
// this receiver ("the checker types the chain `string | undefined`, but
// the entry-module fold lowers it to a compile-time STRING").
//
// That gate was UNREACHABLE. `chainTailClaimed` looks only at the
// checker's type of the guarded receiver — `Module | undefined` is a
// union with a unit arm — so the whole call was routed to the optional
// chain machinery before lowerCall ever ran, and the chain lowered
// `require.main` STANDALONE, which has no lowering: SC2020, a fence that
// executes. `M3`/`M4` of corpus 1629 threw where Node printed.
//
// Everything below is separator- and path-INDEPENDENT on purpose: the
// folded string is POSIX-spelled and Node's is not, so only derived facts
// can be byte-exact.
'use strict';

const name = 'require.main?.filename';

// ── a string method directly on the fold ──────────────────────────────
console.log('A1', require.main?.filename.endsWith('.cjs'));
console.log('A2', require.main?.filename.startsWith('/definitely-not-here/'));
console.log('A3', require.main?.filename.slice(-4));
console.log('A4', require.main?.filename.indexOf('4771') >= 0);

// ── a property tail (no call at all) ──────────────────────────────────
console.log('B1', require.main?.filename.length > 0);

// ── two calls in a row: the second receiver is the first's result ─────
console.log('C1', require.main?.filename.toLowerCase().endsWith('.cjs'));
console.log('C2', require.main?.filename.slice(-4).toUpperCase());

// ── the NON-optional spelling of the same read ────────────────────────
console.log('D1', require.main.filename.endsWith('.cjs'));
console.log('D2', require.main.filename.length > 0);

// ── identity against __filename, both spellings ───────────────────────
console.log('E1', require.main?.filename === __filename);
console.log('E2', require.main.filename === __filename);

// ── under a guard and inside a function, i.e. not only at top level ───
function tail(n) {
  return require.main?.filename.slice(-n);
}
console.log('F1', tail(3));
console.log('F2', typeof tail(4));

if (require.main?.filename.endsWith('.cjs')) {
  console.log('G1', 'branch taken');
} else {
  console.log('G1', 'branch missed');
}

// ── the harness's own skip() shape, the reason this fold exists ───────
const skip = require.main?.filename.startsWith('/known_issues/') ? 1 : 0;
console.log('H1', skip, name.length);

console.log('done');
