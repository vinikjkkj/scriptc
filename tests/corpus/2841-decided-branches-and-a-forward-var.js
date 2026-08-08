// @deferred-fences: 2
// Two halves of one rule: a branch the compiler can DECIDE is a branch it
// must not lower, and a `var` read before its declarator is `undefined`.
//
// Both come from the same place — a vendored bundle's preamble. Every
// bundler emits an environment sniff (`"undefined" != typeof window &&
// window`) whose dead half names values this compiler has no
// representation for, and a list of memoizing thunks (`var a = mod({...}),
// … , var y = mod({...})`) whose EARLIER module bodies call the LATER
// thunks. Neither construct needs the thing that used to be refused: the
// sniff's dead operand never evaluates, and the forward read never runs
// before the declarator does — but "never runs" is not something a
// compiler may assume, so the second half is answered rather than assumed.
//
// A JavaScript entry: `var` hoisting and an untyped forward read only
// exist in JS, and an unannotated function value is what a bundler writes.

// ── a decided test does not lower the branch it decided against ─────────
// `typeof` on a callable standard-library global folds to "function", the
// comparison of two literal strings folds to a constant, and the operand
// the constant rules out is never compiled. Reflect has no static
// lowering at all, so its presence here is the proof: if the dead operand
// were lowered, this program would not build.
console.log("undefined" === typeof setTimeout && Reflect.ownKeys({}));
console.log("function" === typeof setTimeout || Reflect.ownKeys({}));
console.log("function" === typeof setTimeout ? "have timers" : Reflect.ownKeys({}));
console.log("undefined" === typeof setTimeout ? Reflect.ownKeys({}) : "no browser");

// The same rule over plain literal conditions — JS ToBoolean, decided.
console.log(0 && Reflect.ownKeys({}));
console.log(1 || Reflect.ownKeys({}));
console.log(false ? Reflect.ownKeys({}) : "else arm");
console.log(true ? "then arm" : Reflect.ownKeys({}));
if (0) { console.log(Reflect.ownKeys({})); } else { console.log("if-else decided"); }
while (false) { console.log(Reflect.ownKeys({})); }
console.log("loop skipped");

// ...and the value a decided operator yields is an OPERAND, not a boolean:
// `a && b` is `a` when a is falsy, `a || b` is `a` when a is truthy.
console.log(0 && "unreachable");
console.log(1 || "unreachable");
console.log(1 && "second operand", 0 || "second operand");

// A decided test does NOT drop a live operand's effects: only the literal
// side folds away, and the surviving operand still runs.
var effects = 0;
function bump() { effects += 1; return true; }
console.log(1 && bump(), effects);
console.log(0 || bump(), effects);

// ── a `var` read above its declarator is `undefined` ────────────────────
// The function is created above the declaration and reads the binding when
// it is CALLED, which may be either side of the assignment. Both readings
// are here, in one program, over one binding.
function scope() {
  function early() { return later; }
  // Called BEFORE the declarator: JS hoisted the binding, so the read is
  // `undefined` — not a TDZ error, and not the function.
  var before = String(early());
  var typeBefore = typeof early();
  var later = function () { return "later ran"; };
  // Called AFTER: the same binding, now holding the value.
  var after = early()();
  return before + " " + typeBefore + " | " + after + " " + typeof early();
}
console.log(scope());

// The same shape with the thunk chain a bundler actually emits: each
// declarator's value is a function, and an earlier one calls a later one.
function bundle() {
  var out = [];
  function useB() { return typeB()(); }
  function peekB() { return typeB; }
  out.push(String(peekB()));
  var typeA = function () { return function () { return "A"; }; };
  var typeB = function () { return function () { return "B"; }; };
  out.push(typeof typeB, typeA()(), useB());
  return out.join(",");
}
console.log(bundle());

// Reassignment through the widened slot keeps working, and the binding is
// one slot: the closure sees every write.
function rebind() {
  function peek() { return later; }
  var seen = [String(peek())];
  var later = function () { return "first"; };
  seen.push(peek()());
  later = function () { return "second"; };
  seen.push(peek()());
  return seen.join("/");
}
console.log(rebind());

// NOT here, and the omission is the honest half: a WRITE above the
// declarator (`later = fn;` before `var later = fn2;`) still refuses. The
// widened slot can hold the value, but the assignment path has no boxing
// for a function expression flowing into it, and a refusal there is a
// refusal — the read half above is what this fixture pins.
