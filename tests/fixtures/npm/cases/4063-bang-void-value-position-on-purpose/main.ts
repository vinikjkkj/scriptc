// The control for 4032. Statement-position `!e` now lowers as its
// operand's statement, because the boolean is discarded there. VALUE
// position is a different question and keeps ensureBool's fence: an
// operand whose type has no ToBoolean (a `void` call result) still has no
// boolean to produce, and `var forced = !nothing()` needs one.
//
// Without this control, "statement-position `!` lowers" would be
// indistinguishable from "`!` stopped fencing".
//
// The construct lives in the PACKAGE, not here: tsc refuses
// `!voidCall()` in program-owned TS outright ("An expression of type
// 'void' cannot be tested for truthiness"), so a program-owned spelling
// never reaches the lowering. That is the same reason 4032 is a package.
//
// ON PURPOSE: this program does NOT byte-match Node. Node prints
// `forced true`; the compiled binary throws SC2001 at the `!`.
import { forced, ok } from "bangvoidval"

console.log("forced", forced, ok)
