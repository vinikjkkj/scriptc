// The LLVM emitter carried all three of the release-scope defects the C
// emitter has already had fixed: a record literal's fields (3651), an
// array literal's elements (3701) and a seqExpr region's hidden locals
// (3681) were all evaluated into ONE frame, so every may-throw point in
// item k unwound the accumulated dead intermediates of items 0..k and the
// emission was quadratic in the item count. Measured on the emitted .ll:
//
//   arrayLit  p=1 r=3   1.5N^2 + 34.5N + 16  ->  36N + 16
//   arrayLit  p=2 r=3   3.0N^2 + 29.0N + 16  ->  32N + 16
//   recordLit p=1 r=3   1.5N^2 + 35.5N +  9  ->  37N +  9
//   seqExpr             6.0N^2 + 72.0N + 44  ->  72N + 44
//
// — the same quadratic coefficient the C tier had for the two literals
// (the arrayLit block's base(N) = branch(N) + (p*r/2)*N*(N-1) transfers
// unchanged), and twice it for the region, because a SCOPE release on
// this tier is two instructions (load the slot, then call) where a FRAME
// release is one.
//
// It is a size fix, so what this file asserts is that NOTHING moved. It
// passes on base too, and that is the point: a fixture that only passed
// after the change would mean the change had altered behaviour. What it
// pins is everything an early release could break — the values, the
// source order of the effects, the survival of whatever a released
// intermediate borrowed from, identity across two slots, and the unwind
// out of a half-built literal or region.
//
// One construct is deliberately ABSENT: a region in a `while` CONDITION,
// which leaked on this backend until this change (7 heap strings + 5 dyn
// values at exit under SCRIPTC_RC_AUDIT=1). It is a real fix, but a
// corpus program that leaks on the BASE compiler would move the
// documented corpus leak baseline of three; the eight-line reproducer
// lives at repro-fn/leak/a.ts and is measured in estado-llvmscope.md.

export {}

/* ── 1. THE WIDE ARRAY LITERAL ────────────────────────────────────────── */

// Sixteen elements, each an index-signature keyed read with a checked
// extraction: three dead intermediates and one may-throw point apiece.
function pick(m: Record<string, unknown>): string[] {
    return [
        m.a0 as string, m.a1 as string, m.a2 as string, m.a3 as string,
        m.a4 as string, m.a5 as string, m.a6 as string, m.a7 as string,
        m.a8 as string, m.a9 as string, m.b0 as string, m.b1 as string,
        m.b2 as string, m.b3 as string, m.b4 as string, m.b5 as string,
    ]
}

const src: Record<string, unknown> = {}
const keys = ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9",
    "b0", "b1", "b2", "b3", "b4", "b5"]
for (let i = 0; i < keys.length; i++) src[keys[i]] = "v" + String(i)

const picked = pick(src)
console.log("arr len   :", picked.length)
console.log("arr items :", picked.join(","))
// the source map survives the literal and is still readable AND writable
src["a0"] = "rewritten"
console.log("src after :", String(src["a0"]), String(src["b5"]))
console.log("arr again :", picked[0], picked[15])

/* ── 2. THE WIDE RECORD LITERAL ───────────────────────────────────────── */

type Wide = {
    readonly f0?: string; readonly f1?: string; readonly f2?: string
    readonly f3?: string; readonly f4?: string; readonly f5?: string
    readonly f6?: string; readonly f7?: string; readonly f8?: string
    readonly f9?: string
}
function reshape(m: Record<string, unknown>): Wide { const t: Wide = m; return t }

const rsrc: Record<string, unknown> = {}
for (let i = 0; i < 10; i++) rsrc["f" + String(i)] = "w" + String(i)
const wide = reshape(rsrc)
console.log("rec fields:", String(wide.f0), String(wide.f4), String(wide.f9))
console.log("rec source:", String(rsrc["f0"]), String(rsrc["f9"]))

// an ordinary record literal whose field initializers leave intermediates
// behind, including the SAME value in two slots (two retains, and neither
// field scope may free it) and one that borrows from a live object
type Pair = { readonly l: string; readonly r: string; readonly n: string; readonly m: string }
const inner = { name: "inner" }
function twice(s: string): Pair {
    return { l: s.toUpperCase(), r: s.toUpperCase(), n: inner.name, m: s + "!" }
}
const p = twice("dup")
console.log("rec pair  :", p.l, p.r, p.n, p.m, String(p.l === p.r))
console.log("rec inner :", inner.name)

/* ── 3. SOURCE ORDER OF THE EFFECTS ───────────────────────────────────── */

let log = ""
function tap(s: string): string { log = log + s; return s }
const ordered = [tap("x"), tap("y"), tap("z")]
console.log("arr order :", log, ordered.join(""))
log = ""
type Three = { readonly a: string; readonly b: string; readonly c: string }
const orec: Three = { a: tap("p"), b: tap("q"), c: tap("r") }
console.log("rec order :", log, orec.a + orec.b + orec.c)

/* ── 4. IDENTITY AND BORROWED SOURCES ─────────────────────────────────── */

const shared: string[] = ["s0", "s1"]
const holder = [shared, shared]
console.log("identity  :", String(holder[0] === holder[1]), holder[0][0], holder[1][1])
shared.push("s2")
console.log("aliased   :", String(holder[0].length), String(holder[1].length))

const spreadSrc: string[] = ["e0", "e1"]
const spread: string[] = [tap("A"), ...spreadSrc, tap("B"), ...["e2"]]
console.log("spread    :", spread.join(","), String(spreadSrc.length))
spread.push("e3")
console.log("copy-not-alias:", String(spreadSrc.length), String(spread.length))

const nums: number[] = [1, 2, 3, 4]
const bools: boolean[] = [true, false, true]
const nested: string[][] = [["n0"], ["n1", "n2"]]
console.log("scalars   :", nums.join("+"), bools.join("/"), nested[1].join("-"))

/* ── 5. THE seqExpr REGION — a value-position dynamic write ───────────── */

// `const o: any = {}` narrows to `{}` at the declaration and leaves the
// checked-dynamic tree; a call's `any` return does not. 3681's own trick.
function dynObj(): any {
    let o: any = undefined
    o = {}
    return o
}

// The lowering that mints %setRecv / %setKey / %setVal, the triple whose
// whole live range is the region. `let e: any = undefined; e = {}` keeps
// the receiver on the checked-dynamic path; `const e: any = {}` does not.
function enumTable(): string {
    let e: any = undefined
    let t: any = undefined
    e = {}
    t = Object.create(e)
    t[e["k0"] = "v0"] = 0
    t[e["k1"] = "v1"] = 1
    t[e["k2"] = "v2"] = 2
    t[e["k3"] = "v3"] = 3
    return String(e["k0"]) + "," + String(e["k3"]) + "," + String(t["v0"]) + "," + String(t["v3"])
}
console.log("region    :", enumTable())

// the region's VALUE outlives the region — %setVal holds it and the
// expression's value is a read of that local, so an early release is a
// use-after-free that prints garbage rather than diverging quietly
function regionValue(): string {
    const acc: any = dynObj()
    const a = String(acc["p"] = "held")
    const b = String(acc["q"] = "also")
    const c = String(acc["r"] = "third")
    return a + "/" + b + "/" + c + "/" + String(acc["p"])
}
console.log("region val:", regionValue())

// re-entered in a loop BODY, twice over
function regionLoop(): string {
    const acc: any = dynObj()
    let out = ""
    for (let i = 0; i < 3; i++) out = out + String(acc["c" + String(i)] = "c" + String(i))
    let j = 0
    while (j < 3) { out = out + String(acc["d" + String(j)] = "d" + String(j)); j = j + 1 }
    return out + "|" + String(acc["c0"]) + String(acc["d2"])
}
console.log("region lp :", regionLoop())

// nested regions, and a region whose receiver is a record/class
function regionNested(): string {
    const outer: any = dynObj()
    const inner2: any = dynObj()
    outer[(inner2["ik"] = "iv")] = "ov"
    return String(inner2["ik"]) + "=" + String(outer["iv"])
}
console.log("region nst:", regionNested())

class Cell { v: string = "" }
function chainedFields(): string {
    const a = new Cell()
    const b = new Cell()
    a.v = b.v = "chained"
    return a.v + "/" + b.v
}
console.log("region cls:", chainedFields())

/* ── 6. UNWIND OUT OF A HALF-BUILT LITERAL OR REGION ──────────────────── */

function boom(s: string): string { throw new Error("boom:" + s) }

function throwsInArray(): string[] {
    return [tap("k0"), boom("arr"), tap("k1")]
}
log = ""
try { throwsInArray() } catch (err) { console.log("arr throw :", (err as Error).message, log) }

function throwsInRecord(): Three {
    return { a: tap("m0"), b: boom("rec"), c: tap("m1") }
}
log = ""
try { throwsInRecord() } catch (err) { console.log("rec throw :", (err as Error).message, log) }

// a nested literal in the throwing element, so the unwind crosses two
// element scopes at once, and a spread BEFORE it so a borrowed source is
// live in a scope the unwind has to walk
function throwsNested(): string[] {
    return [...spreadSrc, [tap("n0"), boom("nested")].join(""), tap("n1")]
}
log = ""
try { throwsNested() } catch (err) { console.log("nst throw :", (err as Error).message, log, String(spreadSrc.length)) }

// throwing in the RHS of a region, and AFTER completed regions in the
// same function — base released their locals at block exit, the branch
// has already released them, so a double release would show here
function throwsAfterRegions(): string {
    const acc: any = dynObj()
    acc["r0"] = "s0"
    acc["r1"] = "s1"
    const x = String(acc["r2"] = boom("region"))
    return x
}
try { throwsAfterRegions() } catch (err) { console.log("rgn throw :", (err as Error).message) }

// a try INSIDE an element / a field / a region: the handler sits at a
// depth that includes the item's own scope and must resume the literal
function tryInside(): string {
    const arr: string[] = [
        (() => { try { return boom("inner") } catch (e) { return "caught:" + (e as Error).message } })(),
        tap("after"),
    ]
    return arr.join("|")
}
log = ""
console.log("try inside:", tryInside(), log)

function regionInCatch(): string {
    const acc: any = dynObj()
    try { boom("pre") } catch { acc["c"] = "recovered" }
    return String(acc["c"] = String(acc["c"]) + "!")
}
console.log("rgn catch :", regionInCatch())

/* ── 7. AN await IN AN ELEMENT AND IN A FIELD ─────────────────────────── */

async function ident(s: string): Promise<string> { return s }

async function awaited(): Promise<void> {
    const a: string[] = [await ident("w0"), ...spreadSrc, await ident("w1")]
    const r: Three = { a: await ident("y0"), b: "y1", c: await ident("y2") }
    console.log("await arr :", a.join(","))
    console.log("await rec :", r.a + r.b + r.c)
    const acc: any = dynObj()
    const v = String(acc["z"] = await ident("z0"))
    console.log("await rgn :", v, String(acc["z"]))
}

void awaited()
