// A PRICE LIST (the `-on-purpose` convention): the rows below do NOT match
// Node, and the pin exists so the gap has a tag rather than being
// rediscovered a fourth time.
//
// `x.toString()` on a record-typed receiver resolves to
// Object.prototype.toString in the CHECKER, because the structural type
// declares no toString. Where the runtime value is still the class
// instance, the lowering now dispatches to the class's own toString
// (corpus 4141). Where the binding MATERIALIZES a record -- a checked cast
// off a dyn, a parameter, a field, an array element, a reassigned let, a
// union arm -- the class is GONE: the record struct holds the declared
// fields and nothing else, and there is no toString left to reach.
//
// That is a REPRESENTATION loss, not a lookup miss, and it is why
// `Long.toString` in zapo stays fenced: `details.serial` decodes to the
// object arm of `number | Long` on every verified-name certificate, and
// the arm is a record. Forcing the fence prints "[object Object]" where
// Node prints the serial. The `proto` row below IS that shape, in six
// lines, and it is measured rather than argued.
//
//   Node    proto=L:7   own=O:8   shadow=own:9   none=[object Object]  deep=deep:11
//           bare THREW "v.toString is not a function"
//   here    proto/own/shadow/none/deep all "[object Object]"
//
// `none` is the CONTROL: a value with no toString anywhere answers
// "[object Object]" in Node too, so the row that agrees says the pin is
// about the reach and not about the constant.
//
// Closing this needs the record shape to carry a hidden toString slot,
// filled at every materialization site (the dynCheck builder, the width
// helpers, the two projection builders) in both backends -- a
// representation change on the order of block/protoget's, and a block of
// its own. Whoever takes it gets a red test here pointing at this note.
import { makeProto, makeOwn, makeShadow, makeNone, makeDeep, makeBare } from "tostrreach"

interface LongLike {
    low: number
    toNumber(): number
}

const a = makeProto(7) as LongLike
const b = makeOwn(8) as LongLike
const c = makeShadow(9) as LongLike
const d = makeNone(10) as LongLike
const e = makeDeep(11) as LongLike
console.log("proto  = " + a.toString())
console.log("own    = " + b.toString())
console.log("shadow = " + c.toString())
console.log("none   = " + d.toString())
console.log("deep   = " + e.toString())
// A null-prototype dictionary inherits nothing, toString included: Node
// throws `v.toString is not a function`. The fold answers the constant, so
// the divergence here is a THROW turned into a string.
const z = makeBare(12) as LongLike
try {
    console.log("bare   = " + z.toString())
} catch (err) {
    console.log("bare   THREW " + (err as Error).message)
}

// The same loss with no package in sight: a record-typed PARAMETER, FIELD,
// ARRAY ELEMENT and REASSIGNED LET each materialize a record struct out of
// a class instance, and the class's toString does not survive the copy.
// Node answers "Own(1)" on all four.
class Own {
    low = 1
    toNumber(): number { return this.low }
    toString(): string { return "Own(" + this.low + ")" }
}
type Rec = { low: number; toNumber(): number }
class Holder { r: Rec = new Own() }

function param(x: Rec): string { return x.toString() }
const arr: Rec[] = [new Own()]
let re: Rec = new Own()
re = new Own()
console.log("param  = " + param(new Own()))
console.log("field  = " + new Holder().r.toString())
console.log("elem   = " + arr[0]!.toString())
console.log("relet  = " + re.toString())

// And one row that is not about materialization at all, and is now the
// only CLOSED row in this price list: a class whose toString takes an
// OPTIONAL parameter. It reads "r0" here, exactly Node -- the dispatch
// mints each declared parameter's absent-argument value, which is the
// widening this note used to say was deliberately not taken. Corpus 4182
// is the positive case. The eleven rows around it did not move, and that
// is what keeps them useful: they are the no-move control on that change.
//
// Still priced, narrower: a toString whose parameter is REQUIRED has no
// absent-argument value for a bare `string` slot, so the fold stays where
// Node calls the method with `undefined` and answers.
class Radix {
    low = 2
    toNumber(): number { return this.low }
    toString(radix?: number): string { return "r" + (radix ?? 0) }
}
const rx: Rec = new Radix()
console.log("radix  = " + rx.toString())

// And one that is not about classes at all, found while gridding the
// receiver shapes, and now the SECOND closed row here: a TUPLE is a
// record shape with `tuple: true`, and the fold claimed it. In JS a
// tuple IS an array, so Node answers Array.prototype.toString -- "a,1"
// -- and we answered "[object Object]", silently.
//
// This list declined it because `arr.toString()` on a real array was an
// SC2020 fence ('number[].toString' ... has no scriptc lowering yet),
// and teaching tuples to answer while arrays kept refusing would have
// moved the inconsistency rather than fixed it. So BOTH moved: one
// lowering now answers both spellings with join(","), which is what
// `${arr}` and String(arr) had lowered to all along. Corpus 4241 is the
// positive case. The ten materialization rows above did not move, and
// that is what keeps them useful: they are the no-move control on this
// change as well as on the radix one.
const tup: [string, number] = ["a", 1]
console.log("tuple  = " + tup.toString())
