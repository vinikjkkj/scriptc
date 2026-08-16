// `valueOf` on a checked-dynamic receiver, and the control that says the
// Object.prototype arm answering it does NOT shadow a user member.
//
// BYTE-IDENTICAL to Node v25.9.0 on both backends. On base 5 of these 9
// rows differ: the DOT spelling refused with SC1090 while the ELEMENT
// spelling said "o[VO] is not a function" -- two spellings, two different
// wrong answers, for a name Node answers for every receiver kind.
//
// ownVoElem / ownVoDot / ownTsElem / ownTsDot / ownHopElem are THE
// CONTROL, and they are the reason this case exists rather than a line in
// a report: an OWN member must still win. scr_dyn_invoke's OBJ arm does
// its own table lookup FIRST and only falls through to
// dyn_object_proto_method on a miss, so Object.prototype.valueOf can never
// beat a user's. These rows pass on base too -- they are not a claim
// about the change, they are the guard on it.
//
// plainVoElem / plainVoDot / arrVoElem / fnVoElem are what moved: Node
// answers the receiver ITSELF for an object, an array and a function, and
// the row asserts identity (r === o), not just a printed shape.
import { ownVoElem, ownVoDot, ownTsElem, ownTsDot, ownHopElem, plainVoElem, plainVoDot, arrVoElem, fnVoElem } from "vshadow"
console.log("ownVoElem   = " + ownVoElem())
console.log("ownVoDot    = " + ownVoDot())
console.log("ownTsElem   = " + ownTsElem())
console.log("ownTsDot    = " + ownTsDot())
console.log("ownHopElem  = " + ownHopElem())
console.log("plainVoElem = " + plainVoElem())
console.log("plainVoDot  = " + plainVoDot())
console.log("arrVoElem   = " + arrVoElem())
console.log("fnVoElem    = " + fnVoElem())
