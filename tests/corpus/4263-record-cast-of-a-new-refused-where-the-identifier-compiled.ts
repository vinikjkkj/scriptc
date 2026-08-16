// The same asymmetry as 4262, one step louder: where 4262's spellings both
// COMPILED and disagreed about the answer, these two disagreed about whether
// the program compiles at all.
//
//   const i = new Own(); const w = i as Wide      // compiled on base
//   const v = (new Own()) as Wide                 // SC2002 on base
//
// base: "SC2002: record shapes must match exactly or width-coerce:
//        expected '{ extra: string; low: number }', got 'Own'"
//
// `Wide` declares a member `Own` does not have, so the cast cannot be a width
// COPY -- and on base the `new` spelling was forced to be one, because
// constructedClassInfoOf broke on a record target and the binding fell
// through to widthCoerce. The identifier spelling never went that way:
// adoptedInstanceClassOf peels the same cast, the slot keeps the instance,
// and reads resolve as the class's own. Two spellings, one compiled.
//
// TypeScript accepts both casts. Node runs both and answers 1 / Own(1) /
// undefined, so nothing here is a type error the language objects to.
//
// Reading the member the class does NOT have (`extra`) is still refused on
// both spellings and on both sides -- it is kept OUT of this program because
// a compile refusal is fatal to a whole TU, and measured separately as
// "SC1090: reading 'extra' from a value of type 'Wide'". What moved is only
// WHICH refusal the `new` spelling gets: base refused at the CAST, so the
// reads below never ran; now the cast is accepted and an unreadable member
// is refused at the READ, exactly as it already was for the identifier
// spelling. Neither side ever answers `extra` wrongly.

// Own deliberately declares ONLY `low` and `toString`, so `Wide` stays
// assignable TO Own and tsc admits the cast. Give Own a member Wide lacks
// (a `toNumber`, say) and the overlap disappears and tsc refuses it first
// with SC0001 -- measured, and the reason this fixture's classes are thin.
class Own {
    low = 1
    toString(): string { return "Own(" + this.low + ")" }
}

class Der extends Own {
    override toString(): string { return "Der(" + this.low + ")" }
}

type Wide = { low: number; extra: string }
type Exact = { low: number }

// ---- the rows that do not COMPILE on base ----------------------------
const fromNew = (new Own()) as Wide
console.log("fromNew.low    = " + fromNew.low)
console.log("fromNew.str    = " + fromNew.toString())

const fromNewDer = (new Der()) as Wide
console.log("fromNewDer.str = " + fromNewDer.toString())

const parenNew = ((new Own())) as Wide
console.log("parenNew.low   = " + parenNew.low)

// ---- the control that ALREADY compiled on base -----------------------
// the identifier spelling of the very same cast, through adoptedInstanceClassOf
const inst = new Own()
const fromIdent = inst as Wide
console.log("fromIdent.low  = " + fromIdent.low)
console.log("fromIdent.str  = " + fromIdent.toString())

// ---- controls that must not move -------------------------------------
// a cast to a record the class DOES satisfy: a plain adoption, both sides
const exact = (new Own()) as Exact
console.log("exact.str      = " + exact.toString())

// a class with no toString anywhere still folds, and that is Node's answer
class NoTs { low = 7 }
const nots = (new NoTs()) as Wide
console.log("nots.str       = " + nots.toString())

// the fields still read through the adopted class
console.log("fieldRead      = " + (fromNew.low === 1 && exact.low === 1 ? "fields ok" : "fields WRONG"))

// block scope already compiled this on base -- the control that names the
// whole thing a file-scope/block-scope divergence
function blockScope(): string {
    const b = (new Own()) as Wide
    return b.toString()
}
console.log("blockScope     = " + blockScope())
