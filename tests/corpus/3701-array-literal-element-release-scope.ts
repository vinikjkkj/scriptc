// The emitter used to build an array literal inside ONE statement frame:
// every element expression's leftover intermediates — the retained
// receiver, the object it was read out of, the read that fed the push —
// sat in that frame until the literal finished. Every may-throw element
// emits an `if (scr_exc_pending())` whose unwind releases the whole live
// frame, so element k's cleanup block listed every temp of elements 0..k
// and the emission was QUADRATIC in the element count. This is the exact
// sibling of the record-literal defect that 3651 pins.
//
// Each element expression now gets its own release scope. The value still
// MOVES into the array — moveTemp reaches through every frame — and what
// dies at the end of an element is only what nothing can read again. A
// SPREAD's source array is borrowed for its copy loop and dies with the
// same scope. The releases are unchanged in count, in order and in type;
// they happen earlier within the same literal. An unwind still releases
// everything live, because releaseForJump walks all frames.
//
// It is a size fix, so what this file asserts is that nothing moved: the
// values, the source order of the elements' effects, the survival of
// everything a released intermediate borrowed from, and the unwind out of
// a half-built literal. Anything freed one step too early would print
// garbage or crash rather than diverge quietly.
//
// Measured on an N-element literal of index-signature reads: 1.5N^2 +
// 15.5N + 9 lines -> exactly 17N + 9 (N=200: 63 109 lines / 1 863 980
// bytes -> 3 409 lines / 108 287 bytes).

export {}

/* ── 1. THE WIDE LITERAL — the quadratic site itself ──────────────────── */

// Twenty elements, each an index-signature keyed read with a checked
// extraction: three dead intermediates and one may-throw point apiece,
// which is the shape whose cleanup blocks used to grow 3 releases per
// element.
function pick(m: Record<string, unknown>): string[] {
    return [
        m.a0 as string,
        m.a1 as string,
        m.a2 as string,
        m.a3 as string,
        m.a4 as string,
        m.a5 as string,
        m.a6 as string,
        m.a7 as string,
        m.a8 as string,
        m.a9 as string,
        m.b0 as string,
        m.b1 as string,
        m.b2 as string,
        m.b3 as string,
        m.b4 as string,
        m.b5 as string,
        m.b6 as string,
        m.b7 as string,
        m.b8 as string,
        m.b9 as string,
    ]
}

const bag: Record<string, unknown> = {}
const keys = ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9",
              "b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9"]
for (let i = 0; i < keys.length; i++) bag[keys[i]] = "v" + String(i)

const wide = pick(bag)
console.log("wide first:", wide[0])
console.log("wide mid  :", wide[10])
console.log("wide last :", wide[19])
console.log("wide len  :", wide.length)
console.log("wide join :", wide.join("|"))

// The map the literal READ FROM must be untouched and still writable: the
// intermediates an element scope releases early are the reads, never their
// source.
bag.a0 = "changed"
const wide2 = pick(bag)
console.log("reread    :", wide[0], wide2[0], String(bag.b9))

/* ── 2. SOURCE ORDER OF THE ELEMENTS' EFFECTS ─────────────────────────── */

const order: string[] = []
function mark(tag: string, value: string): string {
    order.push(tag)
    return value
}

const three: string[] = [mark("x", "X"), mark("y", "Y"), mark("z", "Z")]
console.log("order     :", order.join(","))
console.log("three     :", three[0], three[1], three[2])

/* ── 3. LEFTOVER INTERMEDIATES THAT BORROW FROM A LIVE OBJECT ─────────── */

// `src.inner.name` leaves the retained `src.inner` behind as a dead temp:
// exactly the kind of value the element scope now releases early. The
// object it was read out of has to survive, and be readable afterwards.
type Inner = { readonly name: string; readonly tag: string }
type Outer = { readonly inner: Inner; readonly n: number }

const src: Outer = { inner: { name: "NAME", tag: "TAG" }, n: 7 }
const flat: string[] = [src.inner.name, src.inner.tag, String(src.n)]
console.log("flat      :", flat[0], flat[1], flat[2])
console.log("src alive :", src.inner.name, src.inner.tag, src.n)

// The SAME object in two slots: two independent retains, and neither
// element's scope may free it out from under the other.
const shared: Inner = { name: "SHARED", tag: "S" }
const pair: Inner[] = [shared, shared]
console.log("pair      :", pair[0].name, pair[1].name, shared.name)
console.log("pair same :", pair[0] === pair[1], pair[0] === shared)

// An array OF arrays and an array of records, so the moved-in value is
// itself refcounted and nested one level down.
const nested: string[][] = [[src.inner.name], [src.inner.tag, "x"], []]
console.log("nested    :", nested[0][0], nested[1][0], nested[1][1], nested[2].length)
const recs: Inner[] = [{ name: "r0", tag: "t0" }, { name: "r1", tag: "t1" }]
console.log("recs      :", recs[0].name, recs[1].tag, recs.length)

/* ── 4. SPREADS — the element kind an array literal has and a record does not ── */

// A spread's source array is BORROWED for the copy loop: its elements copy
// in (+1 each) and the source itself dies with the element scope, one step
// earlier than before. It must still be readable, and the copy must be a
// copy.
const seed: string[] = ["s0", "s1"]
const spread1: string[] = [...seed, "mid", ...seed]
console.log("spread1   :", spread1.join(","), spread1.length)
console.log("seed alive:", seed.join(","), seed.length)

// A spread in the MIDDLE, between two may-throw elements, and a spread of
// a freshly built array whose only reference is the literal itself.
const spread2: string[] = [bag.a1 as string, ...seed, ...["f0", "f1"], bag.a2 as string]
console.log("spread2   :", spread2.join(","), spread2.length)

// Mutating the source afterwards must not touch the copy.
seed.push("s2")
console.log("copy      :", spread1.join(","), seed.join(","))

// Spreads of number and boolean arrays take the scalar push path, where
// the element value is never refcounted and never moves.
const nums: number[] = [1, 2]
const moreNums: number[] = [0, ...nums, 3, ...nums]
console.log("nums      :", moreNums.join(","), nums.join(","))
const flags: boolean[] = [true, ...[false, true], false]
console.log("flags     :", flags.join(","), flags.length)

/* ── 5. AN UNWIND OUT OF A HALF-BUILT LITERAL ─────────────────────────── */

// The element expression throws in the middle of the literal. Elements
// before it have run and their values already moved into the array;
// elements after it never run. The unwind releases the array and the
// current element's scope, and the program keeps going.
function boom(): string {
    throw new Error("element boom")
}

const seen: string[] = []
function note(tag: string): string {
    seen.push(tag)
    return tag
}

function halfBuilt(): string[] {
    return [note("x"), boom(), note("z")]
}

try {
    const bad = halfBuilt()
    console.log("unreached :", bad[0])
} catch (e) {
    console.log("caught    :", (e as Error).message)
}
console.log("ran       :", seen.join(","))

// Again with a NESTED literal in the throwing element, so the unwind
// crosses two element scopes at once.
function nestedBoom(): string[][] {
    return [[note("n")], [note("m"), boom()], [note("never")]]
}
try {
    nestedBoom()
} catch (e) {
    console.log("nested    :", (e as Error).message)
}
console.log("ran2      :", seen.join(","))

// And with a SPREAD before the throwing element, so the borrowed source
// array is live in a scope the unwind has to walk.
function spreadBoom(): string[] {
    return [...seed, note("sp"), boom()]
}
try {
    spreadBoom()
} catch (e) {
    console.log("spreadthr :", (e as Error).message)
}
console.log("seed ok   :", seed.join(","))

// A try INSIDE an element expression: its handler is recorded at a frame
// depth that includes the element's own scope, so the catch must resume
// the literal rather than unwind out of it.
function guarded(): string {
    try {
        return boom()
    } catch {
        return "recovered"
    }
}
const g: string[] = [note("gx"), guarded(), note("gz")]
console.log("guarded   :", g[0], g[1], g[2])
console.log("ran3      :", seen.join(","))

/* ── 6. AN AWAIT IN AN ELEMENT EXPRESSION ─────────────────────────────── */

// The coroutine split lands inside an element's scope. Everything live has
// to survive the suspension, and the scope still closes on resume.
async function later(v: string): Promise<string> {
    return v
}

async function awaited(): Promise<string[]> {
    return [await later("ax"), note("ay"), await later("az"), ...seed]
}

const aw = await awaited()
console.log("awaited   :", aw.join(","), aw.length)
console.log("ran4      :", seen.join(","))

/* ── 7. EVERYTHING READ AGAIN AFTER EVERYTHING ────────────────────────── */

console.log("final     :", wide[0], wide[19], flat[0], pair[1].tag,
             spread1[2], moreNums[1], String(flags[0]), aw[0], src.inner.name)
