// `o[k](...)` reaches String and Number methods, and answers exactly what
// the DOT spelling answers -- byte-identical to Node v25.9.0 on both
// backends.
//
// Every row prints  <element> | <dot> | SAME/DIFFER  computed inside the
// program from ONE receiver in ONE call, so the two spellings are compared
// against each other as well as against Node. Every row here reads SAME.
//
// THIS CASE FAILS ON BASE. There, every string and number row throws
// "s[UP] is not a function" -- which is a LIE, not a fence: Node has
// toUpperCase, and a program feature-detecting with `if (s[k])` takes the
// wrong branch in silence.
//
// The cause was two disjoint tables in two languages. The dot spelling is
// claimed by the frontend out of DYN_STRING_ONLY_METHODS and never reaches
// the runtime; the element spelling cannot consult a compile-time table --
// its key is a runtime value -- so it reached scr_dyn_invoke, whose STR arm
// held seven names and whose NUM receiver had no arm at all.
//
// WHY THIS IS NOT A RECEIVER-BINDING CASE, measured rather than argued:
// `typeof s[k]` was `undefined` on base where Node says `function`. The
// member never resolved, so there was no `this` to drop. That is what
// makes it a different mechanism from 4113, where the member DOES resolve,
// the call DOES run, and only the receiver is wrong.
//
// The residual -- names this deliberately does NOT implement -- is 4152.
import { rUpper, rLower, rTrim, rTrimStart, rTrimEnd, rCharAt, rCharAtOob, rCharCodeAt, rCharCodeOob, rStartsWith, rStartsWithNo, rEndsWith, rSubstring, rSubstringOne, rRepeat, rRepeatZero, rPadStart, rPadStartFill, rPadEnd, rStrToString, rStrValueOf, rNumToString, rNumRadix2, rNumRadix16, rNumRadix36, rFracToString, rNumValueOf, rStrHasOwn, rNumHasOwn, rBoolToString } from "keyedstrnum"
console.log("rUpper        = " + rUpper())
console.log("rLower        = " + rLower())
console.log("rTrim         = " + rTrim())
console.log("rTrimStart    = " + rTrimStart())
console.log("rTrimEnd      = " + rTrimEnd())
console.log("rCharAt       = " + rCharAt())
console.log("rCharAtOob    = " + rCharAtOob())
console.log("rCharCodeAt   = " + rCharCodeAt())
console.log("rCharCodeOob  = " + rCharCodeOob())
console.log("rStartsWith   = " + rStartsWith())
console.log("rStartsWithNo = " + rStartsWithNo())
console.log("rEndsWith     = " + rEndsWith())
console.log("rSubstring    = " + rSubstring())
console.log("rSubstringOne = " + rSubstringOne())
console.log("rRepeat       = " + rRepeat())
console.log("rRepeatZero   = " + rRepeatZero())
console.log("rPadStart     = " + rPadStart())
console.log("rPadStartFill = " + rPadStartFill())
console.log("rPadEnd       = " + rPadEnd())
console.log("rStrToString  = " + rStrToString())
console.log("rStrValueOf   = " + rStrValueOf())
console.log("rNumToString  = " + rNumToString())
console.log("rNumRadix2    = " + rNumRadix2())
console.log("rNumRadix16   = " + rNumRadix16())
console.log("rNumRadix36   = " + rNumRadix36())
console.log("rFracToString = " + rFracToString())
console.log("rNumValueOf   = " + rNumValueOf())
console.log("rStrHasOwn    = " + rStrHasOwn())
console.log("rNumHasOwn    = " + rNumHasOwn())
console.log("rBoolToString = " + rBoolToString())
