// `${x}`, String(x) and `x + ''` over a CLASS INSTANCE, which is the same
// operation `x.toString()` has answered since 4141 -- and which ensureString
// had no arm for at all.
//
// A class receiver fell through every branch of the string conversion to
// badType, so on base every dispatching row below is
// `SC2001: values of type 'Own' cannot be compiled yet`, while the SAME
// value spelled `x.toString()` printed the answer one line away. Two
// spellings of one operation; only one of them answered.
//
// ToPrimitive with the STRING hint is toString first, and every toString the
// dispatch admits returns a string, so valueOf is never consulted and
// String()/`${}` ARE the dispatch. `x + ''` is the DEFAULT hint, valueOf
// first -- a class declaring its own valueOf keeps the fence there rather
// than answering with the string hint's dispatch (tests/diagnostics/
// tostring-conversions-that-must-not-answer.ts is that half).
//
// The CONTROLS are the rows whose right answer IS "[object Object]": a class
// with no toString anywhere, and an object literal. A fix that printed
// anything else for them would be a different wrong answer.

class Own {
    low = 1
    toString(): string { return "Own(" + this.low + ")" }
}

class Base {
    low = 2
    toString(): string { return "Base(" + this.low + ")" }
}
class Middle extends Base { }
class Deep extends Middle { }
class Over extends Base {
    override toString(): string { return "Over(" + this.low + ")" }
}

class Silent { low = 3 }

abstract class Abs {
    low = 6
    abstract toString(): string
}
class Conc extends Abs {
    override toString(): string { return "Conc(" + this.low + ")" }
}

class Radix {
    low = 7
    toString(radix?: number): string { return "r" + (radix ?? 0) }
}

type Rec = { low: number }

// 1-3. the three spellings on a plain class receiver
const own = new Own()
console.log("template  " + `${own}`)
console.log("String    " + String(own))
console.log("plus      " + (own + ''))

// 4. inherited two levels up: the DECLARER is Base, the receiver is Deep
console.log("inherited " + `${new Deep()}`)

// 5. the override reached through the BASE's static type -- a virtual
//    dispatch, not a direct call; the wrong one prints "Base(2)"
const over: Base = new Over()
console.log("override  " + `${over}`)

// 6. an abstract toString with a concrete override below
const abs: Abs = new Conc()
console.log("abstract  " + String(abs))

// 7. a toString with an OPTIONAL parameter has a zero-argument entry point
console.log("radix     " + `${new Radix()}`)

// 8-9. a record-annotated binding that ADOPTED the class keeps it, and the
//      conversion reaches the class's toString through the structural type
const adopted: Rec = new Own()
console.log("adoptTpl  " + `${adopted}`)
console.log("adoptStr  " + String(adopted))

// 10. CONTROL: a class with no toString anywhere answers the constant
console.log("silent    " + `${new Silent()}`)

// 11. CONTROL: an object literal through the same record type
const lit: Rec = { low: 4 }
console.log("literal   " + String(lit))

// 12. CONTROL: the Error hierarchy keeps Error.prototype.toString
console.log("error     " + String(new Error("boom")))

// 13. an EFFECTFUL receiver must be evaluated exactly once
let calls = 0
function bumped(): Own { calls += 1; return new Own() }
console.log("effectful " + `${bumped()}`)
console.log("evaluated " + calls)

// 14. several spans in one template, the class in the middle
console.log("spans     " + `a=${1} b=${own} c=${true}`)

// 15. the conversion inside a function, on a parameter typed as the class
function render(x: Base): string { return `[${x}]` }
console.log("param     " + render(new Over()))

// 16. an array of one class's instances, converted element by element
const owns: Own[] = [new Own(), new Own()]
console.log("mapped    " + owns.map((v) => String(v)).join("|"))

// 17. a class that declares BOTH toString and valueOf. The STRING hint asks
//     toString first, so String() and `${}` are the dispatch -- measured on
//     Node v25.9.0. The DEFAULT hint (`x + ''`) asks valueOf first and is
//     the one spelling that must NOT answer here; it keeps its fence, and
//     tests/diagnostics/tostring-conversions-that-must-not-answer.ts pins it.
class Both {
    valueOf(): number { return 42 }
    toString(): string { return "TS" }
}
const both = new Both()
console.log("bothStr   " + String(both))
console.log("bothTpl   " + `${both}`)

// 19-20. a record type that DECLARES toString: JS calls the FIELD, which is
//     what `x.toString()` already did through the record's closure slot and
//     what the conversion refused. And it is the one place a MATERIALIZED
//     class answers correctly -- a class instance passed into a
//     RecTs-typed parameter is projected into that shape with its own
//     toString bound into the slot as a %boundmeth closure, so the
//     conversion reaches it. The rest of that story is npm fixture 4142's
//     price list: a shape with no such field has nowhere to put one.
type RecTs = { low: number; toString(): string }
function viaSlot(x: RecTs): string { return `${x}` }
class Slot {
    low = 9
    toString(): string { return "Slot(" + this.low + ")" }
}
console.log("slotTpl   " + viaSlot(new Slot()))
console.log("slotStr   " + String(new Slot() as RecTs))
