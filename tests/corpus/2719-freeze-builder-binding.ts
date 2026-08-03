// `Object.freeze` over a BUILDER binding.
//
// Freeze compiles over a fresh literal, where frozen-ness is unobservable
// because nothing else holds the value. A named binding normally keeps the
// fence: a later write through it would need the runtime frozen bit that a
// compiled program has no room for.
//
// The builder idiom is the case where the same argument holds anyway -- a
// non-exported file-scope const, filled by top-level statements, handed to
// freeze and never touched again. Three things make it provable: the
// binding cannot be referenced outside this file, every reference other
// than the freeze argument is the TARGET of a write (so it never escaped
// into something that could keep it), and every one of those writes is a
// top-level statement before the freeze (a write inside a function body
// could run later, so those are excluded).
//
// The negative direction -- a write AFTER the freeze -- still fences, and
// is exercised by the diagnostics suite rather than here, since a corpus
// program has to compile.

const BY_NAME: Record<string, number> = {};
for (const k of ["alpha", "beta", "gamma"]) BY_NAME[k] = k.length;
BY_NAME["delta"] = 42;

export const FROZEN: Readonly<Record<string, number>> = Object.freeze(BY_NAME);

console.log(Object.keys(FROZEN).length);
console.log(FROZEN["alpha"], FROZEN["beta"], FROZEN["gamma"], FROZEN["delta"]);

// A second builder, filled from the first -- reads of a frozen table are
// ordinary reads, and the new builder is its own binding.
const LENGTHS: Record<string, string> = {};
for (const k of Object.keys(FROZEN)) LENGTHS[String(FROZEN[k])] = k;
const BY_LENGTH = Object.freeze(LENGTHS);
console.log(Object.keys(BY_LENGTH).length, BY_LENGTH["5"], BY_LENGTH["42"]);

// Freeze over a fresh literal keeps working next to them.
const LIT = Object.freeze({ a: 1, b: 2 });
console.log(LIT.a + LIT.b);
