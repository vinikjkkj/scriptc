// A PRICE LIST (the `-on-purpose` convention): these rows do NOT match Node
// today, and the pin exists so the gap has a tag rather than being
// rediscovered. 4151 is the half that does match.
//
// rSplitFenced / rToFixedFenced -- the ELEMENT spelling. These moved from a
//   LIE to an honest refusal: base said "s[SPL] is not a function" (Node has
//   split); it now says "String.prototype.split on a dynamic value is not
//   supported yet". Still wrong versus Node, but wrong in a way that names
//   itself. Implementing them means the regex machinery, which is a second
//   change with its own evidence.
//
// rSplitDot -- the DOT twin of the row above, and the reason the element
//   refusal is a real asymmetry rather than a shared gap: the frontend
//   answers `s.split("")` from its regex tables and prints Node's `a,b`.
//
// rToFixedDot -- the dot twin refuses too (SC1090), so toFixed is the one
//   name here where both spellings agree and both are wrong. Its element
//   half now uses the same words the dot half does.
//
// rTrulyMissing -- a name no prototype has. The ANSWER is right (a
//   TypeError) but the MESSAGE is not Node's: this prints the subscript
//   spelling `s["nope"] is not a function` where Node prints `s.nope is not
//   a function`. Pre-existing, unchanged by this branch, pinned here
//   because it is the only remaining Node divergence in the package.
import { rUpper, rLower, rSplitFenced, rSplitDot, rToFixedFenced, rToFixedDot, rTrulyMissing } from "keyedstrnum"
console.log("rUpper         = " + rUpper())
console.log("rLower         = " + rLower())
console.log("rSplitFenced   = " + rSplitFenced())
console.log("rSplitDot      = " + rSplitDot())
console.log("rToFixedFenced = " + rToFixedFenced())
console.log("rToFixedDot    = " + rToFixedDot())
console.log("rTrulyMissing  = " + rTrulyMissing())
