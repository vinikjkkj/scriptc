// A `var` in an implicit-any JS function that is MONOMORPHIZED more than
// once. `--npm-static` compiles one JS body once per argument-type
// instance, and `hoistVarBinding`'s memo was keyed by the checker's
// `ts.Symbol` on the LOWERER -- one map for the whole program. Two
// instances of one body share every `var` symbol, so instance 1 was
// handed instance 0's IrLocal: no `varDecl` reached instance 1's frame
// and no local was registered in it, while the declaration still lowered
// to a plain `assign`.
//
// THIS CASE FAILS ON BASE, and it fails as a BUILD error, not a wrong
// answer: `SC9001: internal compiler error: in %m0.r1%1: assign to
// undeclared local/global "x.0"`. An SC9001 is a compiler bug by
// definition and `--best-effort` correctly refuses to defer it, so this
// is the one failure mode on the board that blocks a build outright.
//
// The read count does NOT matter -- r2 (read zero times), r3 (read once)
// and r1 (read twice) all ICE on base, and all three answer Node here.
// What matters is TWO INSTANCES: c3 is the same `var` shape called at one
// type only and builds on base.
//
// CONTROLS: c1/c2 are the `let`/`const` twins of r1/r4 at two argument
// types (block-scoped bindings never enter hoistVarBinding), and c3 is a
// single-instantiation `var`. All three pass on BASE as well -- they are
// the guard on the change, not a claim about it.
import { r1a, r1b, r2a, r2b, r3a, r3b, r4a, r4b, r4c, r5a, r5b, r6a, r6b, r7a, r7b, r8a, r8b, r9a, r9b, c1a, c1b, c2a, c2b, c3a } from "monovar"
console.log("r1a = " + r1a())
console.log("r1b = " + r1b())
console.log("r2a = " + r2a())
console.log("r2b = " + r2b())
console.log("r3a = " + r3a())
console.log("r3b = " + r3b())
console.log("r4a = " + r4a())
console.log("r4b = " + r4b())
console.log("r4c = " + r4c())
console.log("r5a = " + r5a())
console.log("r5b = " + r5b())
console.log("r6a = " + r6a())
console.log("r6b = " + r6b())
console.log("r7a = " + r7a())
console.log("r7b = " + r7b())
console.log("r8a = " + r8a())
console.log("r8b = " + r8b())
console.log("r9a = " + r9a())
console.log("r9b = " + r9b())
console.log("c1a = " + c1a())
console.log("c1b = " + c1b())
console.log("c2a = " + c2a())
console.log("c2b = " + c2b())
console.log("c3a = " + c3a())
