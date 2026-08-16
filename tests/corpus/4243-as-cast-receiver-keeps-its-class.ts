// `const m: Rec = new D() as B` and `const o: B = new D(); const m: Rec =
// o` are two spellings of one thing, and only one of them answered.
//
// A record-annotated binding whose initializer is a `new` ADOPTS the
// class: the slot keeps the instance and member reads resolve as the
// class's own (that is what makes 4141's toString dispatch reachable).
// constructedClassInfoOf peeled parentheses and nothing else, so an
// `as`-cast wrapper hid the `new` from it, the binding materialized a
// record instead, and `m.toString()` folded "[object Object]" where Node
// calls the class's toString. Silent -- no diagnostic on either
// spelling, and the two-step one right beside it printed the answer.
//
// The class the binding adopts is the CAST TARGET's, not the constructed
// one. `new D() as B` lowers to B's pointer through the upcast bridge,
// so a slot typed D would need a downcast of its own initializer and
// fences -- measured on the way here, `SC1090: 'B1' values where 'D4' is
// expected is not supported yet`. Typing the slot B is exact: the value
// IS a B, and the override is reached through the virtual arm, which is
// precisely what the two-step spelling already did.
//
// Only an OBJECT cast target peels. `as Rec` materializes the record
// (4142's price list) and `as unknown` leaves the static world; both
// keep the old answer, and the `viaRecord` row is the control that says
// so.

class B1 {
    low = 1
    toNumber(): number { return this.low }
    toString(pad?: string): string { return "B1" + (pad ?? "_") + this.low }
}
class D2 extends B1 {
    override toString(pad: string = "!"): string { return "D2" + pad + this.low }
}
class D4 extends B1 {
    override toString(pad?: string): string { return "D4" + (pad ?? "#") + this.low }
}
type Rec = { low: number; toNumber(): number }

// THE ROWS THAT MOVE: the `as`-cast spelling, at an override with a
// default and at an override with the base's own signature.
const a: Rec = new D2() as B1
console.log("defaulted = " + a.toString())
const b: Rec = new D4() as B1
console.log("sameSig   = " + b.toString())

// A cast to the class's OWN name, which is the no-op spelling.
const c: Rec = new D4() as D4
console.log("selfCast  = " + c.toString())

// Parenthesised, and doubled -- the peel is a loop, and the OUTERMOST
// target is the one the value has.
const d: Rec = ((new D4() as D4) as B1)
console.log("nested    = " + d.toString())

// THE CONTROLS THAT MUST NOT MOVE.
// No cast at all: the base's own toString, no override anywhere below
// the receiver's static class that the fold could miss.
const e: Rec = new B1()
console.log("baseonly  = " + e.toString())
// The two-step spelling, which already answered and must keep answering
// exactly the same text -- it is what the moved rows were matched to.
const f0: B1 = new D4()
const f: Rec = f0
console.log("twostep   = " + f.toString())
// A cast whose target is a RECORD: that materializes the shape, the
// class pointer is gone before any dispatch can look, and the fold is
// all there is. Node prints D4#1; this is 4142's price arriving by a
// different route, and the row exists so the peel is visibly NOT
// claiming it.
const g: Rec = new D4() as Rec
console.log("viaRecord = " + (g.toNumber() === 1 ? "fields ok" : "fields WRONG"))
// The member reads a record-annotated binding is actually for still work
// through the adopted class.
console.log("fields    = " + b.toNumber() + "," + b.low)
// A `let` the file never writes takes the same adoption route.
let h: Rec = new D2() as B1
console.log("letBind   = " + h.toString())
console.log("letNum    = " + h.toNumber())
