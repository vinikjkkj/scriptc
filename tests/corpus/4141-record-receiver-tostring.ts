// `x.toString()` where the CHECKER's receiver is a structural record but
// the VALUE is still the class instance.
//
// A record-annotated binding does not always materialize a record struct:
// a class instance assigned to one keeps its class pointer, and its own
// toString is right there at runtime. The checker cannot see that -- the
// structural type it resolves the member against declares no toString, so
// the member is Object.prototype.toString -- and the lowering folded the
// spec's DEFAULT answer, "[object Object]", with no diagnostic at all.
// Node calls the class's toString.
//
// Every dispatching row below answered "[object Object]" before. The rows
// that still answer "[object Object]" are the CONTROLS: a class with no
// toString anywhere, and an object literal, are exactly the values whose
// default answer is the right one, and a fix that printed something else
// for them would be a different wrong answer.
//
// Where the binding DOES materialize a record (a parameter, a field, an
// array element, a reassigned let, a union arm, a checked cast off a dyn)
// the class pointer is gone and the default answer is all there is. That
// half is a price list, not a fix: see the 4142 case.

class Own {
    low = 1
    toNumber(): number { return this.low }
    toString(): string { return "Own(" + this.low + ")" }
}

class Base {
    low = 2
    toNumber(): number { return this.low }
    toString(): string { return "Base(" + this.low + ")" }
}
class Middle extends Base { }
class Deep extends Middle { }

class Over extends Base {
    override toString(): string { return "Over(" + this.low + ")" }
}

class Silent {
    low = 3
    toNumber(): number { return this.low }
}

// An ABSTRACT toString reached through a record binding: there is no
// %Abs.toString to call directly, so the dispatch has to be virtual or
// decline. The concrete override below is what makes it reachable.
abstract class Abs {
    low = 6
    toNumber(): number { return this.low }
    abstract toString(): string
}
class Conc extends Abs {
    override toString(): string { return "Conc(" + this.low + ")" }
}

type Rec = { low: number; toNumber(): number }
interface IRec { low: number; toNumber(): number }
type RecTs = { low: number; toString(): string }

// 1. a class instance at a record-annotated const
const a: Rec = new Own()
console.log("const     " + a.toString())

// 2. the same at a let
let b: Rec = new Own()
console.log("let       " + b.toString())

// 3. inherited two levels up: the DECLARER is Base, the receiver is Deep
const c: Rec = new Deep()
console.log("inherited " + c.toString())

// 4. an interface-typed binding, not a type alias
const d: IRec = new Own()
console.log("interface " + d.toString())

// 5. the override reached through the BASE's static type -- a virtual
//    dispatch, not a direct call; the wrong one prints "Base(2)"
const over: Base = new Over()
const e: Rec = over
console.log("override  " + e.toString())

// 6. CONTROL: a class with no toString anywhere answers the default
const f: Rec = new Silent()
console.log("silent    " + f.toString())

// 7. CONTROL: an object literal answers the default
const g: Rec = { low: 4, toNumber(): number { return 4 } }
console.log("literal   " + g.toString())

// 8. CONTROL: a record type that DECLARES toString already dispatched
const h: RecTs = new Own()
console.log("declared  " + h.toString())

// 9. CONTROL: the class receiver itself, never in doubt
const i = new Own()
console.log("class     " + i.toString())

// 10. an EFFECTFUL receiver must be evaluated exactly once
let calls = 0
function bumped(): Own { calls += 1; return new Own() }
console.log("effectful " + (bumped() as Rec).toString())
console.log("evaluated " + calls)

// 11. the optional-chain spelling
const j: Rec = new Own()
console.log("optchain  " + j?.toString())

// 12. a record-typed local inside a function
function viaLocal(): string {
    const local: Rec = new Deep()
    return local.toString()
}
console.log("local     " + viaLocal())

// 13. an abstract toString with a concrete override below
const p: Rec = new Conc()
console.log("abstract  " + p.toString())

// 14. the record binding aliases the instance, so a later mutation shows
const n = new Own()
const o: Rec = n
n.low = 42
console.log("mutated   " + o.toString())
