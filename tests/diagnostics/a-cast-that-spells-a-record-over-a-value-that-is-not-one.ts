/* A CAST can put a record type on a value that is not a record, and the
 * record-consuming lowerings used to believe the checker.
 *
 * `Object.keys(c as unknown as Record<string, unknown>)` over a class
 * instance built its key walk from the CAST's fields, emitted a call whose
 * argument is an `object`, and the IR validator reported the mismatch a
 * pass later:
 *
 *     SC9001: internal compiler error: in %init.0: call %obj.keys.0 arg 0:
 *             expected record, got object — please report this
 *
 * An internal-compiler-error for a construct the compiler had simply
 * declined — the un-laundered spelling `Object.keys(c)` fences cleanly.
 * Worse, `scriptc coverage` graded the same three-line program "fully
 * static": the analysis stopped at lowering and never ran the validator,
 * so none of validate.ts's 487 err() sites could reach a report.
 *
 * Ten of a hundred mechanical laundering mutations (ten consumers over ten
 * value kinds) hit it, across four distinct validator sites and two
 * receiver kinds. Every one of them is a fence now, at the construct, and
 * the message names what the value actually IS — which the cast's own type
 * spelling never says.
 *
 * NOTE the interface-typed bindings below: they carry no cast at all.
 * `const c: I = new C()` is ordinary TypeScript, and it reaches the same
 * hole — the laundering is what a WIDENING assignment does, not something
 * an author has to write `as unknown as` to trigger.
 */
class C {
    x = 1
    y = "s"
}

interface I {
    x: number
    y: string
}

const c = new C()

// Through a double cast.
const viaCast = c as unknown as Record<string, unknown>
console.log(JSON.stringify(Object.keys(viaCast)))

// Through a named record type — the cast's own shape, not Record<>.
const viaShape = c as unknown as { x: number; y: string }
console.log(JSON.stringify(Object.values(viaShape)))
console.log(Object.entries(viaShape).length)
console.log(JSON.stringify(Object.getOwnPropertyNames(viaShape)))

// The field-copy desugar: a spread reads recordGet off the same object.
const spread = { ...viaShape }
console.log(spread.x)

// No cast anywhere: a widening assignment to an interface-typed binding.
const viaInterface: I = c
console.log(JSON.stringify(Object.keys(viaInterface)))

// An Error instance is the other receiver kind the sweep found. The cast
// is taken at the USE, not at the binding: an annotated binding reports
// the record-shape mismatch (SC2002) at the initializer instead, one
// fence earlier, and never reaches the key walk at all.
const err = new Error("boom")
console.log(JSON.stringify(Object.keys(err as unknown as { message: string })))
