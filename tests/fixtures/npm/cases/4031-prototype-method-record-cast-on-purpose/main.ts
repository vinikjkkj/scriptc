// A checked cast of a shipped package's CLASS INSTANCE to a record type
// that includes a METHOD. Node reads `toNumber` through the prototype
// chain and calls it with `this` bound to the instance.
//
// This USED to be the price list for a refusal: the emitted record
// walkers read members with `scr_dyn_obj_get`, own-only by construction,
// so the method was invisible and the cast threw
// `expected function at $.toNumber, got undefined` -- with ZERO fences
// and a "fully static" coverage report, which is why no trap census
// could see it. It now byte-matches Node, through
// `scr_dyn_obj_member_get`: the [[Get]] walk, and the inherited method
// bound to the receiver it was found through (a record field is a COPY,
// so without the binding `this.high` reads undefined).
//
// The directory keeps its `-on-purpose` name so the ts7 order-parity
// baseline stays additive. The cases that ARE still on purpose are 4062.
import { make } from "protolong"

interface LongLike {
    low: number
    high: number
    unsigned: boolean
    toNumber(): number
}

const v = make(7, 0) as LongLike
console.log(v.low, v.high, v.unsigned, v.toNumber())
