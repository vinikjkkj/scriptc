// `const updates: Record<string, unknown> = {}`, filled by conditional
// assignments and handed to a slot typed as a declared all-optional record.
// tsc admits it through the index-signature hole (a target whose every
// member is optional has nothing to be missing), which makes this the
// ordinary spelling of "build a patch object" — and it is zapo's
// `newsletter.update`, verbatim in shape.
//
// recordWidthPlan already had the reshape: for a target field the source
// does not DECLARE, an index-signature source READS it by its literal key
// (present is the value, absent is the undefined arm — exactly Node's own
// property read). The read's type then has to lift into the field, and
// when the signature's value type is `unknown` that read is a DYN. The
// width relation had no dyn-source rule at all, so every field declined,
// the pair declined, and a UNION destination fell all the way through to
// strandedCoercionTrap — a helper whose entire body is `throw`. Every
// call to zapo's newsletter.update() threw before it reached the socket.
//
// The conversion was never missing, only unoffered: coerceToExpected puts
// a dyn into any canDynCheckTo slot with the validated extraction, and
// coercibleValue already answered yes for this very pair.
//
// What is exercised here is the AGREEING half — the values in the map fit
// the fields, which is what honest code produces. The two disagreeing
// halves cannot be corpus tests because Node does not check an assignment:
// a map holding `null` or a number where the field says `string` throws
// here and prints the value under Node. Those are asserted in
// tests/harness/dyncheck.test.ts ("Record<string, unknown> keyed read: ...",
// two cases), which is where every other lying-cast divergence lives.
//
// The KEY ORDER of the rebuilt record is the declared shape's, not the
// map's insertion order. That is the width family's existing stance for
// every index-signature source (a `Record<string, string>` source reshapes
// the same way on main, byte-identically), not something this rule
// introduces — so the JSON below is written in declared order, and the
// insertion-order case is recorded in estado-strand2.md rather than
// asserted as agreement it does not have.

type Updates = {
    readonly name?: string
    readonly description?: string
    readonly picture?: string
    readonly settings?: Readonly<Record<string, unknown>>
}

type Vars = {
    readonly newsletter_id?: string
    readonly updates?: Updates
}

/** The destination: a UNION slot (`Updates | undefined`) reached through a
 * field of an object literal — the position that stranded. */
function runMex(v: Vars): string {
    return JSON.stringify(v)
}

/** zapo's `createAdminOps().update`, with the socket removed. */
function update(
    jid: string,
    input: { name?: string; description?: string; reactionCodes?: string },
): string {
    const updates: Record<string, unknown> = {}
    if (input.name !== undefined) updates.name = input.name
    if (input.description !== undefined) updates.description = input.description
    if (input.reactionCodes !== undefined) {
        updates.settings = { reaction_codes: input.reactionCodes }
    }
    return runMex({ newsletter_id: jid, updates })
}

console.log("empty     :", update("1@newsletter", {}))
console.log("name      :", update("2@newsletter", { name: "N" }))
console.log("two       :", update("3@newsletter", { name: "N", description: "D" }))
console.log("nested    :", update("4@newsletter", { name: "N", reactionCodes: "all" }))

// The same lift where the destination is NOT a union — the plain record
// slot, which shares recordWidthPlan and had the identical hole.
function plain(u: Updates): string {
    return `${String(u.name)}/${String(u.description)}/${String(u.picture)}`
}
const direct: Record<string, unknown> = {}
direct.name = "only-name"
console.log("plain     :", plain(direct))

// An absent key must answer the UNDEFINED arm, not throw: the keyed read's
// whole reason for existing. Read the fields back one at a time.
const sparse: Record<string, unknown> = {}
sparse.description = "d"
function fields(u: Updates): void {
    console.log("name?     :", u.name)
    console.log("desc?     :", u.description)
    console.log("picture?  :", u.picture)
    console.log("settings? :", u.settings)
}
fields(sparse)

// A signature whose value type is CONCRETE still takes the pre-existing
// lift, unchanged — the dyn rule is additional, not a replacement.
type Privacy = { readonly about?: string; readonly groupAdd?: string }
const concrete: Record<string, string> = {}
concrete.about = "contacts"
function privacy(p: Privacy): string {
    return `${String(p.about)}|${String(p.groupAdd)}`
}
console.log("concrete  :", privacy(concrete))

// An `unknown`-valued map into a target field that is itself `unknown`:
// the dyn read lands in a dyn slot, which is the pre-existing absentDyn /
// copy path and must not have become a checked extraction.
type Loose = { readonly a?: unknown; readonly b?: unknown }
const loose: Record<string, unknown> = {}
loose.a = 7
function looseRead(l: Loose): string {
    return `${String(l.a)}|${String(l.b)}`
}
console.log("loose     :", looseRead(loose))

// The map's values ARE read back as their own types once extracted — the
// extraction is a check, not a re-encode.
const typed: Record<string, unknown> = {}
typed.name = "abc"
function len(u: Updates): number {
    return u.name === undefined ? -1 : u.name.length
}
console.log("length    :", len(typed))

// Repeated conversions of the SAME map must be independent copies: the
// width family rebuilds rather than aliases (SEMANTICS.md 35).
const shared: Record<string, unknown> = {}
shared.name = "first"
const a1 = runMex({ updates: shared })
shared.name = "second"
const a2 = runMex({ updates: shared })
console.log("copy1     :", a1)
console.log("copy2     :", a2)
