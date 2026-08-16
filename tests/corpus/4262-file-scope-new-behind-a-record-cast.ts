// `const v = (new C()) as Rec` answered one thing at FILE scope and another
// inside a function, and the file-scope answer was the wrong one.
//
// A record-annotated binding whose initializer is a `new` ADOPTS the class:
// the slot keeps the instance, member reads resolve as the class's own, and
// 4141's toString dispatch is reachable through it. constructedClassInfoOf
// peeled parentheses and OBJECT-targeted casts; a RECORD-targeted cast broke
// the loop, on the stated grounds that "a cast to a RECORD materializes the
// shape (4142's price)".
//
// That was inherited, not measured, and its own sibling disproves it.
// adoptedInstanceClassOf peels exactly this cast -- it refuses only an
// OBJECT target and `as any` under --dynamic -- so the IDENTIFIER spelling
// `const t = new C(); const v = t as Rec` adopts the class at file scope
// today. One build of the two spellings emits
//     static sc_o_Own *sc_g_e_v4;   /* const b = new Own(); b as Rec */
//     static sc_rs_r0 *sc_g_e_v3;   /* (new Own()) as Rec            */
// so the record target never forced a materialization; it was hiding the
// `new` from a syntactic test, one row over from the hiding estado-silent
// found for the OBJECT target.
//
// And the same declaration inside a function already answered the class,
// because lowerVarDecl's adoption arm reads the LOWERED initializer. The
// `blockScope` row is the control that says this was a scope divergence and
// not a representation loss: it prints the right answer on BOTH sides.
//
// NOT closed here, and deliberately: a record that genuinely MATERIALIZES
// (a parameter, a field, an array element, a reassigned let, a union arm, a
// return, a ternary, a checked cast off a dyn) still loses an undeclared
// toString, because the shape has no slot for one. 4142 is that pin.

class Own {
    low = 1
    toNumber(): number { return this.low }
    toString(): string { return "Own(" + this.low + ")" }
}

class Der extends Own {
    override toString(): string { return "Der(" + this.low + ")" }
}

class NoTs {
    low = 7
    toNumber(): number { return this.low }
}

type Rec = { low: number; toNumber(): number }
type Data = { low: number }

// ---- the rows that move ----------------------------------------------
const bare = (new Own()) as Rec
console.log("bare        = " + bare.toString())

const annotated: Rec = (new Own()) as Rec
console.log("annotated   = " + annotated.toString())

const parens = ((new Own())) as Rec
console.log("parens      = " + parens.toString())

const puredata = (new Own()) as Data
console.log("puredata    = " + puredata.toString())

const derived = (new Der()) as Rec
console.log("derived     = " + derived.toString())

let reletFree: Rec = (new Own()) as Rec
console.log("letNeverSet = " + reletFree.toString())

// ---- the rows that must NOT move -------------------------------------
// the identifier spelling, which already adopted through adoptedInstanceClassOf
const inst = new Own()
const viaIdent = inst as Rec
console.log("viaIdent    = " + viaIdent.toString())

// the plain annotation, which already adopted through constructedClassInfoOf
const plain: Rec = new Own()
console.log("plain       = " + plain.toString())

// a class with no toString anywhere: the fold is the RIGHT answer
const nots = (new NoTs()) as Rec
console.log("noToString  = " + nots.toString())

// `as unknown` leaves the static world and keeps the old representation
const viaUnknown = (new Own()) as unknown as Rec
console.log("viaUnknown  = " + (viaUnknown.toNumber() === 1 ? "fields ok" : "fields WRONG"))

// a plain literal has no class to adopt
const lit: Rec = { low: 3, toNumber() { return 3 } }
console.log("literal     = " + lit.toString())

// the fields still read, through the adopted class rather than a record
console.log("fieldRead   = " + (bare.low === 1 && bare.toNumber() === 1 ? "fields ok" : "fields WRONG"))

// the CONTROL that names this a scope divergence: identical on both sides
function blockScope(): string {
    const inner = (new Own()) as Rec
    return inner.toString()
}
console.log("blockScope  = " + blockScope())

// a REASSIGNED let is not an adoption candidate -- bindingHoldsItsInitializer
// refuses it -- so this row keeps the materialized answer on both sides.
let reassigned: Rec = (new Own()) as Rec
reassigned = { low: 9, toNumber() { return 9 } }
console.log("reassigned  = " + reassigned.toString())
