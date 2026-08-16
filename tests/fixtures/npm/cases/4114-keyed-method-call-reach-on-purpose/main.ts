// A PRICE LIST for what `o[k](...)` still cannot do, and a regression pin
// for the five rows it now can. See the package header for the measured
// grid: five rows went from a wrong answer to Node's, two moved from a
// misleading "is not a function" to an honest refusal, and two -- a dyn
// STRING and a dyn NUMBER receiver -- are still refused here while the dot
// spelling answers them from the frontend's static method tables.
import { dPush, dReduce, dFlat, dSlice, dHasOwn, dUpper, dToString, dMissing, dNumMiss, dFnApply, dFnCall, tPush, tReduce, tFlat, tSlice, tHasOwn, tUpper, tToString, tFnApply } from "keyedreach"
console.log("dPush     = " + dPush())
console.log("dReduce   = " + dReduce())
console.log("dFlat     = " + dFlat())
console.log("dSlice    = " + dSlice())
console.log("dHasOwn   = " + dHasOwn())
console.log("dUpper    = " + dUpper())
console.log("dToString = " + dToString())
console.log("dMissing  = " + dMissing())
console.log("dNumMiss  = " + dNumMiss())
console.log("dFnApply  = " + dFnApply())
console.log("dFnCall   = " + dFnCall())
console.log("tPush     = " + tPush())
console.log("tReduce   = " + tReduce())
console.log("tFlat     = " + tFlat())
console.log("tSlice    = " + tSlice())
console.log("tHasOwn   = " + tHasOwn())
console.log("tUpper    = " + tUpper())
console.log("tToString = " + tToString())
console.log("tFnApply  = " + tFnApply())
