// The emitter used to build a record literal inside ONE statement frame:
// every field initializer's leftover intermediates — the retained
// receiver, the retained key literal, the read they fed — sat in that
// frame until the literal finished. Every may-throw field emits an
// `if (scr_exc_pending())` whose unwind releases the whole live frame, so
// field k's cleanup block listed every temp of fields 0..k and the
// emission was QUADRATIC in the field count. zapo's
// `Proto.ISyncActionValue` reshape (a ~200-field protobuf message) came
// out as one 335 881-byte C function.
//
// Each field initializer now gets its own release scope. The value still
// MOVES into the struct — moveTemp reaches through every frame — and what
// dies at the end of a field is only what nothing can read again. The
// releases are unchanged in count, in order and in type; they happen
// earlier within the same literal. An unwind still releases everything
// live, because releaseForJump walks all frames.
//
// It is a size fix, so what this file asserts is that nothing moved: the
// values, the source-order of the initializers' effects, the survival of
// everything a released intermediate borrowed from, and the unwind out of
// a half-built literal. Anything freed one step too early would print
// garbage or crash rather than diverge quietly.
//
// Measured: the helper for a Record<string, unknown> -> N-optional-field
// reshape goes from 1.5N^2 lines to exactly 17N + 5 (N=200: 63 105 lines
// / 1 863 502 bytes -> 3 405 lines / 107 815 bytes).

export {}

/* ── 1. THE WIDE RESHAPE — the quadratic site itself ──────────────────── */

type Wide = {
    readonly a0?: string
    readonly a1?: string
    readonly a2?: string
    readonly a3?: string
    readonly a4?: string
    readonly a5?: string
    readonly a6?: string
    readonly a7?: string
    readonly a8?: string
    readonly a9?: string
    readonly b0?: string
    readonly b1?: string
    readonly b2?: string
    readonly b3?: string
    readonly b4?: string
    readonly b5?: string
    readonly b6?: string
    readonly b7?: string
    readonly b8?: string
    readonly b9?: string
}

function widen(m: Record<string, unknown>): Wide {
    const w: Wide = m
    return w
}

const sparse: Record<string, unknown> = {}
sparse.a0 = "first"
sparse.b9 = "last"
sparse.b4 = "middle"
const w = widen(sparse)
console.log("wide first:", w.a0)
console.log("wide mid  :", w.b4)
console.log("wide last :", w.b9)
console.log("wide gap  :", w.a5)

// The map the reshape READ FROM must be untouched and still writable: the
// intermediates a field scope releases early are the reads, never their
// source. Read the first copy's value out BEFORE mutating — the rebuilt
// record is a copy here and an alias under Node, which is the width
// family's existing divergence (estado-strand2 §2.4) and not this file's
// subject, so it is never compared across the mutation.
const first = w.a0
sparse.a0 = "changed"
const w2 = widen(sparse)
console.log("reread    :", first, w2.a0, String(sparse.b4))

/* ── 2. SOURCE ORDER OF THE INITIALIZERS' EFFECTS ─────────────────────── */

const order: string[] = []
function mark(tag: string, value: string): string {
    order.push(tag)
    return value
}

type Three = { readonly x: string; readonly y: string; readonly z: string }
const t: Three = { x: mark("x", "X"), y: mark("y", "Y"), z: mark("z", "Z") }
console.log("order     :", order.join(","))
console.log("three     :", t.x, t.y, t.z)

/* ── 3. LEFTOVER INTERMEDIATES THAT BORROW FROM A LIVE OBJECT ─────────── */

// `src.inner.name` leaves the retained `src.inner` behind as a dead temp:
// it is exactly the kind of value the field scope now releases early. The
// object it was read out of has to survive, and be readable afterwards.
type Inner = { readonly name: string; readonly tag: string }
type Outer = { readonly inner: Inner; readonly n: number }
type Flat = { readonly name: string; readonly tag: string; readonly n: number }

const src: Outer = { inner: { name: "NAME", tag: "TAG" }, n: 7 }
const flat: Flat = { name: src.inner.name, tag: src.inner.tag, n: src.n }
console.log("flat      :", flat.name, flat.tag, flat.n)
console.log("src alive :", src.inner.name, src.inner.tag, src.n)

// The SAME value in two field slots: two independent retains, and neither
// field's scope may free the shared object out from under the other.
type Pair = { readonly one: Inner; readonly two: Inner }
const shared: Inner = { name: "SHARED", tag: "S" }
const pair: Pair = { one: shared, two: shared }
console.log("pair      :", pair.one.name, pair.two.name, shared.name)

/* ── 4. AN UNWIND OUT OF A HALF-BUILT LITERAL ─────────────────────────── */

// The field initializer throws in the middle of the literal. Fields before
// it have run and their values already moved into the struct; fields after
// it never run. The unwind releases the record and the current field's
// scope, and the program keeps going.
function boom(): string {
    throw new Error("field boom")
}

const seen: string[] = []
function note(tag: string): string {
    seen.push(tag)
    return tag
}

function halfBuilt(): Three {
    return { x: note("x"), y: boom(), z: note("z") }
}

try {
    const bad = halfBuilt()
    console.log("unreached :", bad.x)
} catch (e) {
    console.log("caught    :", (e as Error).message)
}
console.log("ran       :", seen.join(","))

// And again with a NESTED literal in the throwing field's initializer, so
// the unwind crosses two record scopes at once.
function nestedBoom(): Outer {
    return { inner: { name: note("n"), tag: boom() }, n: 1 }
}
try {
    nestedBoom()
} catch (e) {
    console.log("nested    :", (e as Error).message)
}
console.log("ran2      :", seen.join(","))

// A try INSIDE a field initializer: its handler is recorded at a frame
// depth that includes the field's own scope, so the catch must resume the
// literal rather than unwind out of it.
function guarded(): string {
    try {
        return boom()
    } catch {
        return "recovered"
    }
}
const g: Three = { x: note("gx"), y: guarded(), z: note("gz") }
console.log("guarded   :", g.x, g.y, g.z)

/* ── 5. OVERFLOW ENTRIES ──────────────────────────────────────────────── */

// Undeclared keys of an index-signature shape insert into the overflow map
// in the same interleaved order, and the map takes ownership — the field
// scope must not release what it just handed over.
const bag: Record<string, string> = { alpha: "A", beta: "B", gamma: "C" }
console.log("bag       :", bag.alpha, bag.beta, bag.gamma)
console.log("bag json  :", JSON.stringify(bag))

const mixed: Record<string, unknown> = { s: "str", n: 42, b: true, u: undefined }
console.log("mixed     :", String(mixed.s), String(mixed.n), String(mixed.b), String(mixed.u))

/* ── 6. AN AWAIT IN A FIELD INITIALIZER ───────────────────────────────── */

// The coroutine split lands inside a field's scope. Everything live has to
// survive the suspension, and the scope still closes on resume.
async function later(v: string): Promise<string> {
    return v
}

async function awaited(): Promise<Three> {
    return { x: await later("ax"), y: await later("ay"), z: note("az") }
}

const aw = await awaited()
console.log("awaited   :", aw.x, aw.y, aw.z)
console.log("ran3      :", seen.join(","))

/* ── 7. THE WIDE RESHAPE, READ FIELD BY FIELD AFTER EVERYTHING ────────── */

console.log("final     :", first, w.b4, w.b9, w2.a0, flat.name, pair.two.tag)
