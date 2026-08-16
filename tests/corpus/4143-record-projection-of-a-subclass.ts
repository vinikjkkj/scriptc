// A SUBCLASS instance projected onto a record type whose method the BASE
// declares. The projection emits a direct call to `%Base.m` and used to
// hand it the SUBCLASS receiver unupcast, which fails IR validation:
//
//   SC9001: internal compiler error: in %ctorwitness.0.1:
//   call %Base.toNumber arg 0: expected object, got object
//   (expected object:Base, got object:Deep) -- please report this
//
// A five-line program crashed the compiler. Both projection builders
// (%ctorwitness, for a class instance widened into a record slot, and
// %witness) now upcast the receiver to the DECLARER, which is what an
// ordinary method call has always done.
//
// The rows are the three ways to reach a projection: an argument, a
// reassignment, and an array element. `own` is the control -- a receiver
// whose own class declares the method never needed an upcast and must
// keep answering the same.

class Base {
    low = 2
    toNumber(): number { return this.low }
}
class Middle extends Base { }
class Deep extends Middle {
    constructor() { super(); this.low = 9 }
}
class OwnDecl {
    low = 5
    toNumber(): number { return this.low }
}

type Rec = { low: number; toNumber(): number }

function take(r: Rec): number { return r.toNumber() }
console.log("argument     " + take(new Deep()))
console.log("own          " + take(new OwnDecl()))

let m: Rec = new Base()
console.log("before       " + m.toNumber())
m = new Deep()
console.log("after        " + m.toNumber())

const arr: Rec[] = [new Deep(), new Base(), new OwnDecl()]
console.log("array        " + arr.map((r) => r.toNumber()).join(","))

function ret(): Rec { return new Deep() }
console.log("returned     " + ret().toNumber())
