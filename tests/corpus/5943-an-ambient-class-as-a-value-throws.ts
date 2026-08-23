// @exit: 1
// An ambient `declare class` NOTHING defines is erased by Node, so EVERY
// read of the name that is not `typeof` is a ReferenceError — not only
// `new Amb()`, which is the one arm the compiler had.
//
// WHY THIS PROGRAM EXISTS: the class NAME in value position was claimed
// by the program-class arm, so it answered like a real class object.
// Measured on both backends before the fix, each of these ran clean and
// exited 0 where Node exits 1:
//
//     Amb.name        ->  "Amb"        (a compile-time constant fold off
//                                       the collected shape)
//     const B = Amb   ->  a class value, `typeof B` === "function"
//     [Amb]           ->  an array of length 1
//     Amb.make()      ->  refused loudly (right family, wrong cause)
//
// `Amb.name` is the sharpest of them: not a refusal, not a crash, but a
// correct-looking STRING for a class that does not exist.
//
// stdout is compared byte-for-byte, so the line after the throw
// reappearing fails here. (stderr is not compared for a nonzero exit —
// the uncaught-report format is a documented divergence.)

declare class Amb {
  static make(): Amb;
  readonly y: number;
}

console.log("before");

// `typeof` is the one exception and it is asserted in 5942; here the name
// is READ, and the read throws.
console.log("after", Amb.name);

console.log("this line must never print");
