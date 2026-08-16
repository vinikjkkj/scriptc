// `x.toString()` on a record-typed receiver whose class declares its
// toString with OPTIONAL parameters.
//
// JS gives `toString(radix?: number)` a zero-argument entry point:
// `x.toString()` calls it with no argument, and the body's `radix ?? 0`
// is written for exactly that. The emitted C signature is arity-exact,
// so the record-receiver dispatch declined every non-nullary toString
// and folded the spec's default answer, "[object Object]", with no
// diagnostic at all. 4142's `radix` row priced that; this closes it by
// minting each declared parameter's absent-argument value, the same
// interned undefined arm an ordinary omitted argument gets -- so the
// callee cannot tell this call from `x.toString()` written by hand.
//
// Every dispatching row below answered "[object Object]" before.
//
// CONTROLS: `silent` (a class with no toString anywhere) and `literal`
// (an object literal) are the receivers whose default answer is the
// RIGHT one, and a change that printed something else for them would be
// a different wrong answer. `nullary` is the already-working row -- if
// it moves, the widening broke the case it was built on.
//
// NOT A ROW HERE, and still a price: a toString whose parameter is
// REQUIRED. `toString(sep: string)` has no absent-argument value (the
// ABI type is a bare string, with no undefined arm to intern), so the
// fold stays. Node calls it with `undefined` and answers. Measured on
// both sides, recorded as a price rather than pinned here, because a
// corpus fixture has to match Node byte for byte.

class Radix {
    low = 2
    toNumber(): number { return this.low }
    toString(radix?: number): string { return "R" + (radix ?? 0) + ":" + this.low }
}

class TwoOpt {
    low = 3
    toNumber(): number { return this.low }
    toString(a?: string, b?: number): string { return "T[" + (a ?? "-") + "," + (b ?? -1) + "]" }
}

class Defaulted {
    low = 4
    toNumber(): number { return this.low }
    toString(radix: number = 10): string { return "D" + radix + ":" + this.low }
}

class Nullary {
    low = 5
    toNumber(): number { return this.low }
    toString(): string { return "N:" + this.low }
}

// Inherited: the DECLARER carries the optional parameter, the receiver
// is two levels down.
class OptBase {
    low = 6
    toNumber(): number { return this.low }
    toString(pad?: string): string { return "B" + (pad ?? "_") + this.low }
}
class OptMiddle extends OptBase { }
class OptDeep extends OptMiddle { }

// Virtual: the override below the static type also carries an optional
// parameter, so the dispatch is a virtual call with a synthesized
// argument, not a direct one. The wrong answer here is "B_6".
class OptOver extends OptBase {
    override toString(pad?: string): string { return "V" + (pad ?? "=") + this.low }
}

// A class with no toString anywhere: the default answer is correct.
class Silent {
    low = 7
    toNumber(): number { return this.low }
}

type Rec = { low: number; toNumber(): number }

// 1. one optional parameter
const a: Rec = new Radix()
console.log("radix     " + a.toString())

// 2. two optional parameters -- both slots need an absent value
const b: Rec = new TwoOpt()
console.log("twoopt    " + b.toString())

// 3. a DEFAULTED parameter: the prologue must apply the default, so the
//    answer is "D10:4" and never "Dundefined:4"
const c: Rec = new Defaulted()
console.log("defaulted " + c.toString())

// 4. inherited from two levels up
const d: Rec = new OptDeep()
console.log("inherited " + d.toString())

// 5. a VIRTUAL dispatch to an override that also takes an optional
const over: OptBase = new OptOver()
const e: Rec = over
console.log("override  " + e.toString())

// 6. CONTROL: the nullary row that already worked
const f: Rec = new Nullary()
console.log("nullary   " + f.toString())

// 7. CONTROL: no toString anywhere -- the default answer is the right one
const g: Rec = new Silent()
console.log("silent    " + g.toString())

// 8. CONTROL: an object literal answers the default
const h: Rec = { low: 8, toNumber(): number { return 8 } }
console.log("literal   " + h.toString())

// 9. the class receiver itself, never in doubt
const i = new Radix()
console.log("class     " + i.toString())

// 10. an EFFECTFUL receiver must be evaluated exactly once -- the
//     synthesized arguments must not duplicate the receiver expression
let calls = 0
function bumped(): Radix { calls += 1; return new Radix() }
console.log("effectful " + (bumped() as Rec).toString())
console.log("evaluated " + calls)

// 11. the optional-chain spelling
const j: Rec = new TwoOpt()
console.log("optchain  " + j?.toString())

// 12. a record-typed local inside a function
function viaLocal(): string {
    const local: Rec = new OptDeep()
    return local.toString()
}
console.log("local     " + viaLocal())

// 13. an EXPLICIT argument still wins: this row does not go through the
//     record-receiver dispatch at all (the checker's Object.prototype
//     .toString is nullary, so the class receiver is the only spelling
//     that can pass one), and it pins that the callee really does read
//     the parameter -- without it, every row above would pass even if
//     the synthesized argument were ignored.
console.log("explicit  " + new Radix().toString(16))
