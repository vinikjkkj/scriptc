// `arguments` read from inside an ARROW FUNCTION. An arrow binds no
// `arguments` of its own — ECMA-262 makes the name resolve outward exactly
// like `this` — so every read below names the ENCLOSING non-arrow
// function's object, and its length is the count that CALL was made with.
//
// This is a JavaScript entry on purpose, and the reason is the whole item.
// In TypeScript the arity is checked at every call site, so the declared
// parameter count IS the call's count and the compiler is free to fold
// `arguments.length` to a constant. JavaScript has no such check —
// `outer(1, 2, 3)` against `function outer()` type-checks fine here — so
// the fold has no warrant and the honest answer can only come from the
// call's real argument list. On base the fold fired anyway, one scope too
// far out: every `arguments.length` below answered the ARROW's enclosing
// declaration count, silently, with no diagnostic of any kind. Six of the
// lines this file prints were wrong and nothing said so.
//
// What must hold, and each of it is below:
//   * the count is the CALL's, at every arity including zero;
//   * indexed reads past the declared range answer, and past the CALL's
//     range answer undefined;
//   * the object is the nearest enclosing NON-ARROW function's, so an
//     arrow nested in a function expression nested in a function reads the
//     inner one, and an arrow nested in arrows still reads that same one;
//   * it is the same storage the enclosing body reads, so a write through
//     one spelling is visible through the other;
//   * it is per ACTIVATION, so two calls of one factory give two arrows
//     that disagree, recursion sees each frame's own arity, and an arrow
//     that OUTLIVES its call still answers that call;
//   * `this` and `arguments` travel together through the same arrow.
'use strict';

// ── the count is the call's, at every arity ────────────────────────────
function arity() {
  const n = () => arguments.length;
  return n();
}
console.log(arity(), arity(1), arity(1, 2), arity(1, 2, 3, 4, 5));

// ── indexed reads, in and past the range ───────────────────────────────
function pick() {
  const at = (i) => arguments[i];
  return at(0) + '|' + at(1) + '|' + at(2) + '|' + String(at(7));
}
console.log(pick('a', 'b', 'c'));

// ── the object is the NEAREST enclosing non-arrow function's ───────────
function outerFn() {
  const inner = function () {
    return (() => arguments.length + ':' + arguments[0])();
  };
  // The arrow inside `inner` reads INNER's call, not outerFn's.
  return inner('i', 'j') + ' / ' + (() => arguments.length + ':' + arguments[0])();
}
console.log(outerFn('o', 'p', 'q'));

// Arrows nested in arrows keep walking out to the same function.
function deep() {
  const three = () => () => () => arguments.length;
  return three()()();
}
console.log(deep(1, 2, 3, 4, 5, 6));

// A named function DECLARED inside owns its own `arguments`; the arrow in
// its body reads that one, and the arrow beside it reads the outer one.
function bothScopes() {
  function mid() { return (() => arguments.length)(); }
  return mid(1, 2) + '+' + (() => arguments.length)();
}
console.log(bothScopes(9, 9, 9));

// An arrow written inside a nested BLOCK still reaches the function's
// object: the slot belongs to the function scope, not to the block the
// arrow happens to sit in.
function blocked() {
  if (arguments.length > 0) {
    { const a = () => arguments.length; return a(); }
  }
  return -1;
}
console.log(blocked(1, 2, 3, 4, 5, 6, 7));

// ── one storage: a write through the arrow is visible outside it ───────
function shared() {
  const overwrite = () => { arguments[0] = 'W'; };
  overwrite();
  return arguments[0] + '/' + arguments[1] + '/' + arguments.length;
}
console.log(shared('o', 'z'));

// ── per activation, not per function ───────────────────────────────────
function make() {
  return () => arguments.length + ':' + arguments[0];
}
const one = make('p');
const three = make('q', 'r', 's');
// Interleaved on purpose: an arrow that outlives its call still answers
// that call, and calling one must not disturb the other.
console.log(one(), three(), one(), three());

// Recursion: each activation's arrow sees that activation's arity.
function rec() {
  const own = () => arguments.length;
  if (arguments.length > 1) return own() + ',' + rec(0);
  return String(own());
}
console.log(rec(1, 2, 3));

// ── the loop form: protobufjs's spelling of "the caller's surplus" ─────
function tail() {
  const rest = () => {
    const out = [];
    for (let i = 1; i < arguments.length; i++) out.push(arguments[i]);
    return out;
  };
  return arguments[0] + '(' + rest().join(',') + ')';
}
console.log(tail('f', 1, 2, 3));
console.log(tail('g'));

// ── `this` and `arguments` through the same arrow ──────────────────────
function Tagged() {
  this.tag = 'T';
  this.describe = () => this.tag + '#' + arguments.length + '#' + String(arguments[0]);
}
const tagged = new Tagged('x', 'y');
console.log(tagged.describe());

// An object-literal METHOD materializes an argument list too (its calling
// convention is a plain function's), so the arrow inside one reads it.
const lit = {
  m: function () { return (() => arguments.length)(); },
  n() { return (() => String(arguments[0]))(); },
};
console.log(lit.m(1, 2, 3), lit.n('k', 'l'));

// A getter's arity is fixed by the LANGUAGE, not by the declaration: a
// [[Get]] passes nothing whatever the property access looks like. This is
// the one shape where a compile-time count is right in JavaScript too, and
// the one JavaScript shape the fold still answers.
class Gettable {
  get zero() { return (() => arguments.length)(); }
}
console.log(new Gettable().zero);
