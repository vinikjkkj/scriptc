// The `extends <ambient declare class>` family, rendered.
//
// A non-generic class DECLARATION whose `extends` clause names a top-level
// `declare class` nothing defines COMPILES — to exactly the ReferenceError
// Node throws at the class statement (tests/corpus/5950-…). Everything
// here is one of the shapes that does NOT take that shell, plus the value
// uses of a class whose statement provably throws; each must say which
// ambient name is responsible, and no two of them may collapse into the
// same wording, because they have different causes.

declare class AmbientBase {
  constructor();
  readonly y: number;
}

// The shell DOES cover this declaration; what refuses is CONSTRUCTING it.
// The class binding never initializes — Node unwound at the statement
// above — so the refusal stands on provably dead code and says so.
class Derived extends AmbientBase {
  static s = 1;
}
new Derived();
Derived.s;
class UnderDerived extends Derived {}
void UnderDerived;

// A GENERIC family: no single shell can carry it (the instantiations would
// each need one), so the heritage guard answers instead — with the cause,
// not with "extending classes not declared in the program".
class Box<T> extends AmbientBase {
  v: T;
  constructor(v: T) {
    super();
    this.v = v;
  }
}
void new Box<number>(3);

// A class EXPRESSION reaches the same guard through
// lowerClassExpressionInfo.
const K = class extends AmbientBase {};
void K;
