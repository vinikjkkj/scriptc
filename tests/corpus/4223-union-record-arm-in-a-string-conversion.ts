// `${u}` / String(u) where `u` is a union with a plain data RECORD arm.
//
// The union form fenced with "string conversions of unions with object
// arms" while `${rec}` -- the same record, the same ToString -- compiled
// and printed Object.prototype.toString's constant. The two spellings
// answered differently about the same value.
//
// The per-arm rule is the LONE-record rule verbatim, applied per arm: a
// shape that is not a tuple (a tuple prints its elements) and carries no
// `toString` FIELD (which would shadow the prototype's and have to be
// called). Under that test JS's answer IS "[object Object]".
//
// zapo: src/appstate/sync/WaAppStateSyncClient.ts:1021 interpolates
// `patch.exitCode.code`, whose type after zapo's own narrowing is
// `number | { high; low; unsigned; toNumber }` -- spec/proto/index.d.ts:45's
// `Long`, an anonymous RECORD and not a class. Row 1 is that shape.
//
// CONTROLS: row 6 is the LONE record (the spelling that already worked --
// if it moves, the two spellings have gone out of step in the other
// direction), and row 7 is the all-unit union (the arms the fence already
// admitted).
//
// THE PRICE THIS CHANGE PAYS, measured on both sides rather than argued.
// A CLASS instance assigned into a structurally-spelled union arm
// MATERIALIZES into a record: the class pointer is gone and its own
// toString is unreachable. 4141's header already prices exactly that
// ("where the binding DOES materialize a record -- a parameter, a field,
// an array element, a reassigned let, A UNION ARM, a checked cast off a
// dyn -- the class pointer is gone and the default answer is all there
// is"), and the ANNOTATED spelling already paid it:
//
//     class C { low = 1; toString() { return "C!" } }
//     const v: number | { low: number } = new C()
//     `${v}`
//
// prints "[object Object]" on BASE and on BRANCH, where Node prints "C!" --
// measured, byte for byte, at 81f2fcde with no change of mine in it.
// What this change adds is that the FUNCTION-RETURN spelling of the same
// value, which used to REFUSE, now agrees with the annotated one instead
// of disagreeing with it. That is a refusal turning into a known price,
// and it is written down here rather than left implicit: the honest
// reading is that the wrongness is upstream, in the materialization, and
// that a value which really is a record struct at run time has no toString
// to call. A reviewer who weighs it the other way can revert exactly one
// commit -- the identity matrix in estado-eight.md §3 proves this entry is
// separable from the other three.
//
// NOT ROWS HERE, and still prices, each for its own reason:
//   * a CLASS arm -- a class may override toString, so the constant is not
//     its answer and the fence stays;
//   * a record arm carrying a `toString` FIELD -- JS calls it;
//   * an ARRAY arm -- JS joins.
// All three still refuse, which is why they cannot be rows: a corpus
// fixture has to match Node byte for byte.

type LongRec = {
    readonly high: number
    readonly low: number
    readonly unsigned: boolean
    readonly toNumber: () => number
}

function exitCode(n: number): number | LongRec {
    return n > 0 ? n : { high: 0, low: 7, unsigned: false, toNumber: (): number => 7 }
}

// 1. zapo's shape, both arms, in a TEMPLATE
const numArm: number | LongRec = exitCode(1)
const recArm: number | LongRec = exitCode(-1)
console.log(`numarm    terminal exitCode ${numArm}`)
console.log(`recarm    terminal exitCode ${recArm}`)

// 2. the same two arms through String()
console.log("strnum    " + String(numArm))
console.log("strrec    " + String(recArm))

// 3. concatenation, the third spelling of the same conversion
console.log("catnum    " + ("x" + numArm))
console.log("catrec    " + ("x" + recArm))

// 4. a union with a UNIT arm alongside the record: the unit texts must
//    still be "undefined"/"null" and the record still the constant
type Maybe = number | LongRec | undefined | null
function maybe(k: number): Maybe {
    if (k === 0) return undefined
    if (k === 1) return null
    if (k === 2) return 12
    return { high: 1, low: 2, unsigned: true, toNumber: (): number => 3 }
}
console.log(`undef     ${maybe(0)}`)
console.log(`null      ${maybe(1)}`)
console.log(`number    ${maybe(2)}`)
console.log(`record    ${maybe(3)}`)

// 5. TWO different record arms in one union -- each arm is its own tag
type A = { readonly a: number }
type B = { readonly b: string; readonly c: boolean }
function two(k: number): A | B | number {
    if (k === 0) return { a: 1 }
    if (k === 1) return { b: "s", c: true }
    return 9
}
console.log(`twoA      ${two(0)}`)
console.log(`twoB      ${two(1)}`)
console.log(`twoN      ${two(2)}`)

// 6. CONTROL: the LONE record, the spelling that already worked
const lone: LongRec = { high: 0, low: 7, unsigned: false, toNumber: (): number => 7 }
console.log(`lone      ${lone}`)

// 7. CONTROL: the all-unit union the fence already admitted
function units(k: number): number | string {
    return k > 0 ? 5 : "five"
}
console.log(`unitnum   ${units(1)}`)
console.log(`unitstr   ${units(-1)}`)

// 8. narrowing first still works and still answers the arm's own text --
//    the zapo-side workaround must not have been broken by admitting the
//    unnarrowed form
const narrowed: number | LongRec = exitCode(1)
if (typeof narrowed === "number") {
    console.log("narrowed  " + narrowed.toString())
} else {
    console.log("narrowed  " + String(narrowed.toNumber()))
}

// 9. the record arm inside a nested template, so the conversion is not the
//    outermost expression
console.log(`nested    [${`<${recArm}>`}]`)
