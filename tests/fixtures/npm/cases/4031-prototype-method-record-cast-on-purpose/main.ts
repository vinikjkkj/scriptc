// A checked cast of a shipped package's CLASS INSTANCE to a record type
// that includes a METHOD. Node reads `toNumber` through the prototype
// chain and prints; scriptc's emitted record matcher reads members with
// `scr_dyn_obj_get`, which is own-only by construction, so the method is
// invisible and the cast throws.
//
// ON PURPOSE: this program does NOT byte-match Node, and the pin says so.
// It is the wall behind 4032 -- see npm-static.test.ts.
import { make } from "protolong"

interface LongLike {
    low: number
    high: number
    unsigned: boolean
    toNumber(): number
}

const v = make(7, 0) as LongLike
console.log(v.low, v.high, v.unsigned, v.toNumber())
