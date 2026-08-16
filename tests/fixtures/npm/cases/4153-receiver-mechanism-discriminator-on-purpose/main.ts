// A PRICE LIST and a DISCRIMINATOR (the `-on-purpose` convention).
//
// Three gaps in this repo have each been described as "the receiver
// machinery". This case decides, by measurement rather than by argument,
// how many mechanisms that actually is -- and its answer is: more than one.
//
// Every row is measured on TWO axes at once:
//   READ  `typeof o.m` / `typeof o[k]`. If the member does not resolve to
//         a function, the failure is MEMBER RESOLUTION and no receiver
//         plumbing can fix it.
//   BIND  what the callee sees as `this`. If the member resolves and the
//         call runs but `this` is wrong, the failure is RECEIVER BINDING.
//
// THE DECISIVE ROW is m1CallDotFromMethod. The same failing call is made
// from inside a METHOD whose receiver is a different object (tag=OUTER).
// A call primitive that simply forgot to bind leaves the ambient window
// holding the ENCLOSING frame's `this`, so the callee reports OUTER --
// a positive signature, not an absence. It does, and that is what proves
// the record-tier gap (4113) is the SAME mechanism block/varint fixed for
// the dyn tier: the ambient `this` window is the only channel a callee
// has, and any call primitive that does not push on it leaks the caller.
//
// AND THE SAME ROWS PROVE THE OTHER TWO ARE NOT THAT. m3ReadElem and
// m4ReadElem read `undefined` where Node says `function` -- the member
// never resolved, so there was never a `this` to drop. Those are member
// RESOLUTION, closed separately in 4151.
//
// A THIRD FINDING, not previously recorded anywhere, and now CLOSED:
// the keyed READ and the keyed CALL resolved DIFFERENTLY. m2CallInhElem
// answered `true` while m2ReadInhElem answered `undefined` for the same
// member on the same object; m2ReadInhDot showed the DOT read was
// equally blind, and m5ReadElem that it was not specific to objects.
// Node says `function` to all three, and so do we now.
//
// The attribution here was half right, and the correction is worth
// keeping: scr_dyn_obj_key_get DOES walk the stored prototype chain, and
// always did. What the read had no counterpart for is Object.prototype's
// methods and every PRIMITIVE prototype's, which live as C branches
// inside scr_dyn_invoke.c reachable from the CALL alone -- so there was
// nothing to walk, not a walk that was skipped.
// scr_dyn_intrinsic_method_get is the read's half of that same dispatch,
// and it answers exactly the names the dispatch implements or fences
// loudly, so a read can never claim a member a call would deny. Corpus
// 4242 is the positive case and walks that set row by row.
//
// CONTROLS, both directions: m1CtorControl (a constructed receiver binds
// correctly, so the dyn tier is not the thing under test) and
// m1NoThisControl (a record method that never reads `this` is correct on
// every side, so M1 pins one thing and not two).
//
// Node v25.9.0, for the rows that diverge here:
//   m1CallDot=obj tag=L   m1CallDotFromMethod=obj tag=L
//   m2ReadInhElem=function  m2ReadInhDot=function  m5ReadElem=function
//   m3ReadElem/m3ReadDot/m4ReadElem/m4ReadDot=function
// M3's key is `trim`, not `toUpperCase`: toUpperCase is fenced for a
// link-line reason recorded in 4152, and a row that fences for a reason
// unrelated to this case would not show the resolution close it is about.
import { m1ReadDot, m1CallDot, m1CallElem, m1CallDotFromMethod, m1CtorControl, m1NoThisControl, m2ReadOwnElem, m2CallOwnElem, m2ReadInhElem, m2CallInhElem, m2ReadInhDot, m2CallInhDot, m3ReadElem, m3ReadDot, m3CallElem, m3CallDot, m3LenElem, m3IdxElem, m4ReadElem, m4ReadDot, m4CallElem, m4CallDot, m4CallElemArg, m5ReadElem, m5CallElem } from "recvmech"
console.log("m1ReadDot           = " + m1ReadDot())
console.log("m1CallDot           = " + m1CallDot())
console.log("m1CallElem          = " + m1CallElem())
console.log("m1CallDotFromMethod = " + m1CallDotFromMethod())
console.log("m1CtorControl       = " + m1CtorControl())
console.log("m1NoThisControl     = " + m1NoThisControl())
console.log("m2ReadOwnElem       = " + m2ReadOwnElem())
console.log("m2CallOwnElem       = " + m2CallOwnElem())
console.log("m2ReadInhElem       = " + m2ReadInhElem())
console.log("m2CallInhElem       = " + m2CallInhElem())
console.log("m2ReadInhDot        = " + m2ReadInhDot())
console.log("m2CallInhDot        = " + m2CallInhDot())
console.log("m3ReadElem          = " + m3ReadElem())
console.log("m3ReadDot           = " + m3ReadDot())
console.log("m3CallElem          = " + m3CallElem())
console.log("m3CallDot           = " + m3CallDot())
console.log("m3LenElem           = " + m3LenElem())
console.log("m3IdxElem           = " + m3IdxElem())
console.log("m4ReadElem          = " + m4ReadElem())
console.log("m4ReadDot           = " + m4ReadDot())
console.log("m4CallElem          = " + m4CallElem())
console.log("m4CallDot           = " + m4CallDot())
console.log("m4CallElemArg       = " + m4CallElemArg())
console.log("m5ReadElem          = " + m5ReadElem())
console.log("m5CallElem          = " + m5CallElem())
