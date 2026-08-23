// @exit: 1
// `class D extends <ambient declare class>` throws when the CLASS
// STATEMENT evaluates — not when D is used, and not at all if D is never
// used. Node erases a `declare class` entirely, so the `extends` clause
// reads a name nothing defines: `ReferenceError: AmbientBase is not
// defined`, uncaught, exit 1, with nothing below the class statement ever
// running. (stderr — where the uncaught value is reported — is not
// compared: the formats differ, see SEMANTICS.md.)
//
// WHY THIS PROGRAM EXISTS: the compiler used to COLLECT the ambient class
// like a program class, so heritage resolution FOUND a ClassInfo for it
// and this derived class inherited a fabricated base. Every line below the
// class printed, the static field initializer RAN — a side effect Node
// never performs — and the program exited 0. A SILENT wrong answer on both
// backends, where Node prints one line and exits 1. Sibling file 5920
// covers the `new <ambient class>` edge of the same defect and used to
// carry this shape as an explicitly UNCLOSED coverage boundary.
//
// The three lines this program is really asserting are the ones that must
// NOT appear: "STATIC RAN", "INSTANCE FIELD RAN", and "after". stdout is
// compared byte-for-byte, so any of them re-appearing fails here.

declare class AmbientBase {
  constructor();
  readonly y: number;
}

console.log("before the class statement");

// A second ambient declaration in the same file, never extended: it must
// stay inert. Only the name the `extends` clause READS throws.
declare class UnusedAmbient {
  readonly q: number;
}
function annotatesOnly(a: UnusedAmbient): number {
  return a.q;
}
console.log("an ambient class used only as a type is inert:", typeof annotatesOnly);

console.log("last line Node reaches");

class Derived extends AmbientBase {
  // An instance field initializer: it belongs to the class DEFINITION's
  // members, which never collect because the definition never completes.
  z: number = (console.log("INSTANCE FIELD RAN"), 5);
  // A static field initializer runs at the class statement in JS — after
  // the heritage clause. The heritage throws first, so this never runs.
  static s = (console.log("STATIC RAN"), 1);
}

console.log("after");

// NOTE, and it is a real residual: a VALUE use of `Derived` below this
// point -- `new Derived()`, `typeof Derived`, `Derived.s` -- is a build
// REFUSAL, not a compiled throw. The class binding never initializes, so
// the compiler declines to lower uses of it (fenceDecorationThrows, the
// stance the ambient-DECORATOR shell already shipped). Node reaches none
// of them either, so this is a refusal on provably dead code: loud where
// it used to be silently wrong, but not a MATCH. It is why this program
// stops at `after`.
