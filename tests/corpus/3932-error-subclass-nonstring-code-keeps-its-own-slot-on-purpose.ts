// An Error subclass whose `code` is NOT a string keeps a slot of its own,
// and the base `Error` view still answers `undefined` for it. That is a
// deliberate stopping point, not an oversight, and this file exists so a
// later reader does not "finish the job" and make things worse.
//
// The sibling fixture 3931 routes a subclass's own `code` onto ScrError's
// inherited slot, which is what lets one JS property answer through both
// the subclass type and the `Error` view. That slot holds a STRING — it is
// the same slot fs and exec stamp errno names into, and the same one the
// error.code libCall reads as `string | undefined`. A number cannot live
// there.
//
// So there are three things one could do with `code: number`, and only the
// third is right:
//
//   1. Route it anyway. There is no representation; it would corrupt the
//      slot or need a second, wider one, which is a layout change to every
//      error in the program for a shape nothing asks for.
//   2. Refuse the program. `class AppError extends Error { code: number }`
//      compiles today and has since 1301-errors-subclass.ts. Turning a
//      wrong answer into a compile error is not a fix — it is a louder
//      version of the same failure, and it scores as progress on a trap
//      census, which is exactly how a regression gets merged.
//   3. Leave it exactly as it was: an own slot, correct through the
//      subclass type, absent through the base view. A pre-existing
//      divergence, unchanged in either direction by the routing work.
//
// This file therefore pins (3): it prints the SUBCLASS-typed reads, which
// agree with Node, and deliberately does NOT print the base-view read,
// which does not. Printing it would fail the differential — the point is
// that the failure is old, bounded, and known, not that it is invisible.
// The same stance 3921 took for the read this block has now closed.
//
// If a later block gives ScrError a wider code slot, or gives the base
// view a dynamic read, delete this file's third section and print the
// base-view read here.

class Numbered extends Error {
  code: number;
  constructor(msg: string, code: number) {
    super(msg);
    this.name = "Numbered";
    this.code = code;
  }
}

class Boolish extends Error {
  readonly code = true;
  constructor(msg: string) {
    super(msg);
    this.name = "Boolish";
  }
}

const n = new Numbered("mongo said no", 20);
const b = new Boolish("flagged");

// 1. Through the SUBCLASS type: its own slot, and Node agrees.
console.log("A n.code=" + n.code + " typeof=" + typeof n.code);
console.log("A b.code=" + b.code + " typeof=" + typeof b.code);

// 2. Everything that does NOT go through the code slot is unaffected: the
//    name/message prefix is shared with the string case, and toString has
//    no bracket to draw because the code is not a string at all.
console.log("B n name=" + n.name + " message=" + n.message);
console.log("B n str=" + String(n));
console.log("B b str=" + String(b));

function viaError(tag: string, e: Error): void {
  console.log(tag + " view name=" + e.name + " message=" + e.message);
}
viaError("B n", n);
viaError("B b", b);

// 3. NOT printed, on purpose: `(n as NodeJS.ErrnoException).code`. Node
//    answers 20; this answers undefined, because the number lives in the
//    subclass's own slot and the view reads the string slot. See the
//    header — the alternatives are worse than the gap.

// Writes still land in the own slot and read back through it.
n.code = 303;
console.log("C n.code=" + n.code);

// A subclass of the number-coded class inherits that own slot, not the
// routed one, so the whole chain stays consistent with itself.
class DeeperNumbered extends Numbered {
  constructor(msg: string) {
    super(msg, 42);
    this.name = "DeeperNumbered";
  }
}
const d = new DeeperNumbered("deep");
console.log("D d.code=" + d.code + " name=" + d.name + " str=" + String(d));
