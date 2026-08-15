// `Array.isArray(x)`'s TRUE arm keeps the union's array arm.
//
// The lib declares `Array.isArray(arg: any): arg is any[]`. A `readonly T[]`
// arm is NOT assignable to `any[]`, so tsc cannot keep the arm through the
// narrowing and falls back to the predicate's own type: inside the true arm
// every read of `x` is typed bare `any[]`, and `T` is gone. That `any` then
// travels — the contextual signature types a HOF callback's parameter `any`,
// the call's own result comes out `any`, and each of those fenced on its own
// line. `(c: any) => boolean` is the message every one of them wore.
//
// The VALUE was never `any`. maybeNarrow's isArray bridge proves the union's
// ONE array arm with a runtime tag test, and lowerArrayMethodCall already
// rode that bridge to pick the element type. Only the CHECKER type was never
// answered, so this fixture is about the reads agreeing with the value.
//
// The file fails to build on main with SIX SC errors, and r01-r08 are the
// rows that raise them. r09-r12 are the controls: shapes that already
// compiled on main and must answer exactly what they answered before —
// the FALSE arm's own narrowing rule (r09/r10, which sits directly beside the
// new one and must not be disturbed), an annotated callback parameter
// (r11 — an annotation is the author's answer and is never overridden), and
// a guard whose union has no array arm at all (r12).

interface Node2 {
    readonly tag: string
    readonly n: number
    readonly content: readonly Node2[] | Uint8Array | string | undefined
}

const leaf: Node2 = { tag: "tos", n: 1, content: "x" }
const other: Node2 = { tag: "notice", n: 2, content: undefined }
const parent: Node2 = { tag: "root", n: 3, content: [leaf, other, leaf] }
const bytesNode: Node2 = { tag: "b", n: 4, content: new Uint8Array([1, 2, 3]) }

// r01/r02 — `.some` through the true arm, on an array receiver and on a
// non-array one (the false arm still answers its own literal).
function anyTos(n: Node2): boolean {
    return Array.isArray(n.content) ? n.content.some((c) => c.tag === "tos") : false
}
console.log("r01 " + String(anyTos(parent)))
console.log("r02 " + String(anyTos(leaf)) + " " + String(anyTos(bytesNode)))

// r03/r04 — `.filter` keeps the element type, so the result is a real
// `Node2[]` and its elements read as records rather than fencing.
function tosOnly(n: Node2): readonly Node2[] {
    return Array.isArray(n.content) ? n.content.filter((c) => c.tag === "tos") : []
}
console.log("r03 " + String(tosOnly(parent).length) + " " + String(tosOnly(leaf).length))
console.log("r04 " + tosOnly(parent).map((c) => String(c.n)).join(","))

// r05 — `.findIndex` (an F64 result, so only the callback needed the element).
function firstNotice(n: Node2): number {
    return Array.isArray(n.content) ? n.content.findIndex((c) => c.tag === "notice") : -1
}
console.log("r05 " + String(firstNotice(parent)) + " " + String(firstNotice(leaf)))

// r06 — `.every`, and the empty-arm case it shares with `.some`.
//
// NOT TAKEN, and named here so the next block does not have to find it: a
// member read off a MEMBER of the recovered element (`c.tag.length`) still
// fences. The value is right — SCRIPTC_READ_WHY reports `lowered-recv=string
// checker=any` — but the stdlib-member gate on `.length` reads the CHECKER,
// and tsc's `any` is transitive in a way a node-keyed typeOf override cannot
// undo: overriding `c` does not re-type `c.tag`, because typeOf is a lookup
// and not a re-inference. lowerArrayMethodCall already skips its own
// isStdlibMember gate for exactly this reason ("a checker-untyped receiver
// has no stdlib-declared member symbol"); the string/array member paths
// would each need the same, one at a time. `c.n > 0` is the same test one
// read shallower and compiles.
function allTagged(n: Node2): boolean {
    return Array.isArray(n.content) ? n.content.every((c) => c.n > 0) : true
}
console.log("r06 " + String(allTagged(parent)) + " " + String(allTagged(bytesNode)))

// r07 — the callback reads a SECOND field, so the parameter really is bound
// at the record and not at something that merely answers one member.
function sumN(n: Node2): number {
    return Array.isArray(n.content)
        ? n.content.filter((c) => c.n > 1 && c.tag !== "root").length
        : 0
}
console.log("r07 " + String(sumN(parent)))

// r08 — `.find` behind an ANNOTATED binding: the annotation gives the const
// its type, and the found element reads as a record.
function findTos(n: Node2): string {
    const found: Node2 | undefined = Array.isArray(n.content)
        ? n.content.find((c) => c.tag === "tos")
        : undefined
    return found === undefined ? "none" : found.tag + ":" + String(found.n)
}
console.log("r08 " + findTos(parent) + " " + findTos(leaf))

// r09/r10 — CONTROL. The FALSE arm's own narrowing (the rule that already
// sat here) still answers the union's one non-array constituent.
function textOf(n: Node2): string {
    const c = n.content
    return Array.isArray(c) ? "arr:" + String(c.length) : typeof c === "string" ? "str:" + c : "other"
}
console.log("r09 " + textOf(parent) + " " + textOf(leaf))
console.log("r10 " + textOf(bytesNode) + " " + textOf(other))

// r11 — CONTROL. An ANNOTATED callback parameter is the author's own answer
// and is never overridden; this compiled before and answers the same.
function annotated(n: Node2): number {
    return Array.isArray(n.content) ? n.content.filter((c: Node2) => c.n > 0).length : 0
}
console.log("r11 " + String(annotated(parent)) + " " + String(annotated(leaf)))

// r12 — CONTROL. A guard over a union with NO array arm: the true-arm rule
// requires exactly one array constituent, so this one is left entirely alone.
function noArrayArm(v: string | number): string {
    return Array.isArray(v) ? "impossible" : typeof v === "string" ? "s:" + v : "n:" + String(v)
}
console.log("r12 " + noArrayArm("a") + " " + noArrayArm(7))

export {}
