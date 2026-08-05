// A CATCH BINDING read in SHORTHAND property position:
//
//   try { ... } catch (error) { return { ok: false, error } }
//
// An exception snapshot is not a value a slot can take raw — every read of
// one has to narrow it (caughtNarrow), convert it (caughtToDyn), or fence.
// The identifier path routes catch bindings through that rule; the
// shorthand property path resolved the local and handed the raw snapshot
// on, so `{ error }` and `{ error: error }` — the same binding into the
// same slot — compiled to different answers, the shorthand refusing where
// the longhand converted.
//
// What this pins against Node: the shorthand and longhand spellings of the
// SAME conversion agreeing, for an Error payload (identity-preserving —
// `instanceof Error` and `.message` survive), a string payload, a number
// payload and a boolean payload; the NARROWED shorthand reads (typeof
// guards) producing the narrowed value rather than the conversion; a
// shorthand inside a nested object literal; a shorthand whose slot is an
// index-signature value; the rethrow-and-recatch round trip; and the
// snapshot reaching an `unknown` PARAMETER through a shorthand-built
// record.

interface Res {
    readonly ok: boolean
    readonly error?: unknown
}

function longhand(): Res {
    try {
        throw new Error("boom-long")
    } catch (error) {
        return { ok: false, error: error }
    }
}

function shorthand(): Res {
    try {
        throw new Error("boom-short")
    } catch (error) {
        return { ok: false, error }
    }
}

function shorthandString(): Res {
    try {
        throw "plain-string"
    } catch (error) {
        return { ok: false, error }
    }
}

function shorthandNumber(): Res {
    try {
        throw 42
    } catch (error) {
        return { ok: false, error }
    }
}

function shorthandBool(): Res {
    try {
        throw true
    } catch (error) {
        return { ok: false, error }
    }
}

function describe(e: unknown): string {
    if (e instanceof Error) return `Error:${e.message}`
    if (typeof e === "string") return `string:${e}`
    if (typeof e === "number") return `number:${e}`
    if (typeof e === "boolean") return `boolean:${e}`
    return `other:${String(e)}`
}

console.log(longhand().ok, describe(longhand().error))
console.log(shorthand().ok, describe(shorthand().error))
console.log(describe(shorthandString().error))
console.log(describe(shorthandNumber().error))
console.log(describe(shorthandBool().error))

// The NARROWED shorthand read: the slot is typed, so the shorthand must
// produce the narrowed value and not the conversion.
interface Reason {
    readonly reason: string
}
interface Code {
    readonly code: number
}

function narrowedString(): Reason | null {
    try {
        throw "text-reason"
    } catch (reason) {
        if (typeof reason === "string") return { reason }
        return null
    }
}

function narrowedNumber(): Code | null {
    try {
        throw 11
    } catch (code) {
        if (typeof code === "number") return { code }
        return null
    }
}

console.log(narrowedString()?.reason)
console.log(narrowedNumber()?.code)

// A shorthand nested one literal deeper, and one landing in an
// index-signature value slot.
interface Envelope {
    readonly inner: Res
}
interface Bag {
    readonly tag: string
    readonly [key: string]: unknown
}

function nested(): Envelope {
    try {
        throw new Error("nested")
    } catch (error) {
        return { inner: { ok: false, error } }
    }
}

function intoIndexSlot(): Bag {
    try {
        throw new Error("indexed")
    } catch (error) {
        return { tag: "t", error }
    }
}

console.log(describe(nested().inner.error))
console.log(describe(intoIndexSlot()["error"]))

// The snapshot reaching an `unknown` PARAMETER through the shorthand-built
// record, and the rethrow-and-recatch round trip: the Error identity has
// to survive both.
function report(v: unknown): string {
    return describe(v)
}

function rethrown(): string {
    try {
        try {
            throw new Error("once")
        } catch (error) {
            const r: Res = { ok: false, error }
            throw r.error
        }
    } catch (again) {
        const r: Res = { ok: false, error: again }
        return report(r.error)
    }
}

console.log(rethrown())

// The same binding read TWICE in one literal, shorthand and longhand side
// by side: both spellings must box to the same tree.
function bothSpellings(): string {
    try {
        throw new Error("twice")
    } catch (error) {
        const pair = { a: error, error }
        return `${describe(pair.a)}|${describe(pair.error)}`
    }
}

console.log(bothSpellings())
