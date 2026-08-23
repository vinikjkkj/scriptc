// @exit: 1
// `x instanceof <ambient declare class>` is a ReferenceError, not `false`.
//
// Node evaluates the LEFT operand, then the RIGHT one — and the right one
// names a class Node ERASED, so the reference throws before any
// instance-of check happens. There is no boolean answer to this
// expression at all.
//
// WHY THIS PROGRAM EXISTS, and why it is a SEPARATE file from 5952/5953:
// `instanceof` is the one operator whose lowering is allowed to skip its
// right operand. The static fold decides the answer off the class graph —
// "these two classes are unrelated, so always false" — and an ambient
// class is unrelated to everything, so it folded to `false` WITHOUT ever
// looking at the identifier. That made this the one position in the
// family that survived the value-read fix (the commit that made an
// erased `declare` name answer every read but `typeof` with a throw):
// the arms that answer for `Amb.name` and `const B = Amb` never see
// this identifier.
//
// MEASURED ON THE COMPILER AS IT STOOD BEFORE THIS FIX, on both
// backends — and the two spellings differ, which is why the
// wrong-answer cell below binds its left operand to a local instead of
// calling a function:
//
//   const r = new Real(); r instanceof Amb   ->  `after false`, exit 0
//                                                WRONG: Node prints
//                                                `before` and exits 1
//   makeReal() instanceof Amb                ->  SC1090 build refusal
//                                                ("statically-decided
//                                                'instanceof' on computed
//                                                operands"). LOUD, so a
//                                                TRAP, not a wrong answer.
//   err instanceof Amb (catch binding)       ->  SC1090 build refusal
//
// This program is the WRONG->MATCH cell: every `instanceof Amb` in it has
// a plain local on the left, the shape that compiled and lied.

declare class Amb {
  readonly y: number;
}

class Real {
  v = 1;
}

// A control in the same program: `instanceof` over two REAL classes still
// answers, and answers correctly, in both directions.
class Sub extends Real {}
const sub = new Sub();
const plain = new Real();
console.log("real-vs-real", sub instanceof Real, plain instanceof Sub);

console.log("last line Node reaches");

// The left operand is a plain local read, so nothing observable is owed
// to it — the whole expression is the ReferenceError.
const verdict = plain instanceof Amb;

console.log("never", verdict);
