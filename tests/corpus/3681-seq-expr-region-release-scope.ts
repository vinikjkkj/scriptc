// A value-position write into a checked-dynamic receiver — `t[e[k] = v] = n`,
// the enum table every protobuf codec generator emits — lowers to a seqExpr
// whose statements mint a fresh %setRecv/%setKey/%setVal triple of
// FUNCTION-scope hidden locals. The triple is dead the instant the seqExpr's
// value exists, but it lived in the enclosing BLOCK scope, so every later
// `if (scr_exc_pending())` in that block released all of them: N writes in one
// function came out as 3N^2 + 50N + 31 lines of C. zapo's fn4042 is 230 such
// entries in one function — 7 559 580 bytes, 170 229 lines, 96.6 % of them
// release calls.
//
// A seqExpr region now owns the hidden locals whose entire live range it is,
// and releases them once its value has been produced. The emission drops to
// exactly 50N + 31 lines. Which locals qualify is COMPUTED rather than
// assumed: hidden (%-prefixed, bound to no ts.Symbol), unboxed, declared by
// one of the region's own statements, and mentioned exactly as often inside
// the region as in the whole function body.
//
// This is a SIZE fix, so what this file asserts is that nothing moved. It
// passes on the base compiler too, and that is the point: a fixture that only
// passed on the branch would mean the change had altered behaviour. What it
// pins is everything an early release could break — the yielded value's
// survival past the region, aliasing between the region's locals and what the
// container now owns, the source order of the effects, unwinds out of a
// half-built region, regions nested inside regions, and regions re-entered in
// a loop.

export {}

/* ── 0. A CHECKED-DYNAMIC OBJECT ──────────────────────────────────────── */

// `const o: any = {}` narrows to `{}` at the declaration; a call's `any`
// return does not, so this is how the tests below get a receiver that is
// still on the checked-dynamic tree.
function dynObj(): any {
    let o: any = undefined
    o = {}
    return o
}

/* ── 1. THE ENUM TABLE — the quadratic site itself ────────────────────── */

function buildTable(): any {
    let e: any = undefined
    let t: any = undefined
    e = {}
    t = Object.create(e)
    {
        t[e["ZERO"] = "zero"] = 0
        t[e["ONE"] = "one"] = 1
        t[e["TWO"] = "two"] = 2
        t[e["THREE"] = "three"] = 3
        return t
    }
}

const table: any = buildTable()
console.log("table     :", String(table["zero"]), String(table["one"]), String(table["two"]), String(table["three"]))

/* ── 2. THE YIELDED VALUE OUTLIVES THE REGION ─────────────────────────── */

// The region's %setVal holds the assigned value; the expression's value is a
// read of that local. If the region released before producing the value this
// is a use after free — the string would print as garbage or the process
// would die, not diverge quietly.
const sink: any = dynObj()
function makeKey(n: number): string {
    return "k" + String(n)
}
const yielded: any = (sink["a"] = makeKey(1) + "-" + makeKey(2))
console.log("yielded   :", String(yielded), String(sink["a"]))

// The value is still readable after further regions have opened and closed.
const y2: any = (sink["b"] = "second")
const y3: any = (sink["c"] = "third")
console.log("survives  :", String(yielded), String(y2), String(y3))
console.log("stored    :", String(sink["a"]), String(sink["b"]), String(sink["c"]))

/* ── 3. ALIASING: THE REGION AND THE CONTAINER HOLD THE SAME VALUE ────── */

// The container took ownership of exactly the value the region's %setVal
// names. Releasing the region must not take the container's copy with it.
const holder: any = dynObj()
const shared = "SHARED-" + String(table["zero"])
const alias: any = (holder["x"] = shared)
console.log("alias     :", String(alias), String(holder["x"]), shared)

// The same receiver and the same key written twice: two regions, two
// independent retains of one object.
const twice: any = dynObj()
const w1: any = (twice["k"] = "one")
const w2: any = (twice["k"] = "two")
console.log("twice     :", String(w1), String(w2), String(twice["k"]))

/* ── 4. SOURCE ORDER OF THE REGION'S EFFECTS ──────────────────────────── */

// JS evaluates the member reference (receiver, then key) before the RHS. The
// region's statements are emitted in that order and the scope must not
// reorder them.
const order: string[] = []
function mark(tag: string, value: string): string {
    order.push(tag)
    return value
}
const target: any = dynObj()
function recv(): any {
    order.push("recv")
    return target
}
const composed: any = (recv()[mark("key", "kk")] = mark("val", "vv"))
console.log("order     :", order.join(","))
console.log("composed  :", String(composed), String(target["kk"]))

/* ── 5. AN UNWIND OUT OF A HALF-BUILT REGION ──────────────────────────── */

function boom(): string {
    throw new Error("region boom")
}

const seen: string[] = []
function note(tag: string): string {
    seen.push(tag)
    return tag
}

// Throw in the RHS: the receiver and the key are already in the region's
// locals, the write never happens, and the unwind releases the region and
// everything outside it exactly once.
const victim: any = dynObj()
function throwInRhs(): void {
    const v: any = (victim[note("k1")] = boom())
    console.log("unreached :", String(v))
}
try {
    throwInRhs()
} catch (e) {
    console.log("caught rhs:", (e as Error).message)
}
console.log("victim    :", String(victim["k1"]), seen.join(","))

// Throw in the KEY: nothing of the region past the receiver is live yet.
function throwInKey(): void {
    const v: any = (victim[boom()] = note("v2"))
    console.log("unreached :", String(v))
}
try {
    throwInKey()
} catch (e) {
    console.log("caught key:", (e as Error).message)
}
console.log("ran       :", seen.join(","))

// A throw AFTER several completed regions in the same function: those regions
// released their locals on the normal path and the unwind must not release
// them a second time.
function manyThenThrow(): void {
    const acc: any = dynObj()
    const a: any = (acc["a"] = note("a"))
    const b: any = (acc["b"] = note("b"))
    const c: any = (acc["c"] = note("c"))
    console.log("before    :", String(a), String(b), String(c))
    boom()
}
try {
    manyThenThrow()
} catch (e) {
    console.log("caught mny:", (e as Error).message)
}
console.log("ran2      :", seen.join(","))

/* ── 6. A TRY AROUND A REGION, AND A REGION IN A CATCH ────────────────── */

function guarded(): string {
    const box: any = dynObj()
    try {
        const v: any = (box[note("g1")] = boom())
        return String(v)
    } catch {
        const r: any = (box[note("g2")] = "recovered")
        return String(r) + "/" + String(box["g2"])
    }
}
console.log("guarded   :", guarded())

/* ── 7. NESTED REGIONS ────────────────────────────────────────────────── */

// A region inside a region: the inner one's locals belong to the inner
// region, the outer's to the outer, and an unwind releases innermost first.
const outerObj: any = dynObj()
const innerObj: any = dynObj()
const nested: any = (outerObj[(innerObj["ik"] = "iv")] = "ov")
console.log("nested    :", String(nested), String(innerObj["ik"]), String(outerObj["iv"]))

/* ── 8. A REGION RE-ENTERED IN A LOOP ─────────────────────────────────── */

// The region is emitted once and executed many times: each pass takes fresh
// values into the same C locals, so each pass must release its own.
function loopFill(n: number): any {
    const acc: any = dynObj()
    let last: any = ""
    for (let i = 0; i < n; i++) {
        last = (acc["i" + String(i)] = "v" + String(i))
    }
    return acc
}
const filled: any = loopFill(5)
console.log("loop      :", String(filled["i0"]), String(filled["i4"]))

// And in a while loop whose CONDITION contains the region — the one place the
// enclosing block scope was outside the loop, so the region's locals were
// overwritten once per pass and released once in total.
function loopCond(): string {
    const acc: any = dynObj()
    let i = 0
    while (String(acc["c" + String(i)] = "c" + String(i)) !== "c3") {
        i = i + 1
    }
    return String(acc["c0"]) + "," + String(acc["c3"]) + "," + String(i)
}
console.log("while     :", loopCond())

/* ── 9. THE RECORD / CLASS RECEIVER ARM ───────────────────────────────── */

// `a.len = o.head = 0` — the chained write whose inner assignment is an
// expression over a RECORD receiver. Same lowering shape, a different
// container, and the region owns the same kind of hidden pair.
type Node2 = { head: number; tag: string }
type Holder = { len: number; name: string }
const nodeRec: Node2 = { head: 9, tag: "T" }
const holdRec: Holder = { len: 1, name: "H" }
holdRec.len = nodeRec.head = 0
console.log("chained   :", holdRec.len, nodeRec.head)

nodeRec.tag = (holdRec.name = "renamed")
console.log("chained2  :", nodeRec.tag, holdRec.name)

class Cell {
    v: string
    constructor(v: string) {
        this.v = v
    }
}
const cellA = new Cell("a")
const cellB = new Cell("b")
cellA.v = cellB.v = "both-" + String(table["one"])
console.log("class     :", cellA.v, cellB.v)

/* ── 10. DESTRUCTURING AND COMPOUND ASSIGNMENT IN VALUE POSITION ──────── */

// Two other seqExpr builders. They keep today's emission (their locals are
// not region-confined, or are not hidden), and this file's job is to say so
// out loud by exercising them beside the ones that changed.
let d1 = 0
let d2 = 0
const destr: number[] = ([d1, d2] = [11, 22])
console.log("destr     :", d1, d2, destr[0], destr[1])

let acc2 = 7
const compound = (acc2 += 5)
console.log("compound  :", compound, acc2)

/* ── 11. EVERYTHING READ ONCE MORE, AFTER EVERYTHING ──────────────────── */

console.log("final     :", String(table["three"]), String(yielded), String(holder["x"]), String(twice["k"]), String(outerObj["iv"]))
console.log("final2    :", seen.join(","), order.join(","))
