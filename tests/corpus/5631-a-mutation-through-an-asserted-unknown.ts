// A MUTATION whose receiver is an ASSERTION over an `unknown` — the row
// 5630's header excludes by name, and the rest of its family.
//
// 5630 pins the writes that stay on ONE side of the static/dyn boundary. This
// file is its twin on the side that CROSSES it, and it exists because that
// side used to be silently wrong rather than loudly refused.
//
// `as` is the IDENTITY in JS. `(u as T).k = v` writes the very object `u`
// names; there is no second object for the write to land on. scriptc keeps a
// composite in two physically different representations — a monomorphic C
// struct / packed ScrArr, and a `ScrDyn` key-value table — so the dyn->static
// recovery an assertion used to lower to cannot alias: `sc_dc_N` / `sc_da_N`
// build a FRESH value with `sc_rnew_rN`. The store landed on that fresh
// value, the object the program still named was unchanged, nothing trapped,
// and the process exited 0.
//
// Measured before the fix, on both backends, against Node v25.9.0: of the
// mutating surfaces exactly ONE was loud — `(u as unknown[]).push(x)`, where
// the asserted type is itself dynamic so nothing is recovered — one refused
// at compile time (`Object.defineProperty`), and every other spelling a real
// program writes was silently wrong. Ten of them are the rows below.
//
// Every row keeps a NAME for the dyn and reads the mutation back through it.
// Without that readback the copy is unobservable and the row proves nothing:
// the recovered value really did get written, it was simply not the object
// anyone could see. That is the whole shape of the defect, and it is why a
// test that only checks the recovered value passes on a broken compiler.
//
// The source values all come out of `JSON.parse`, so the dyn IS the object —
// no static original exists and no `scr_dyn_mark_static_copy` is involved.
// The marked-copy direction must REFUSE instead of landing, and a refusal
// cannot live in a byte-compared corpus file; it is pinned in
// tests/harness/dyn-asserted-mutation.test.ts.
//
// `fill` and `copyWithin` used to be excluded from this file for a second
// reason: `dyn_arr_proto_unimpl` claimed both names, so they threw "not
// supported" before the static-copy guard that also names them could fire,
// and two of that guard's nine arms were unreachable. The dyn ARR arm
// answers them now, so rows r20-r24 below are ordinary byte-compared rows
// and the two guard arms have their own coverage in the harness file.

interface Ctx {
  stanzaId?: string
  participant?: string
}
interface Carrier {
  text?: string
  contextInfo?: Ctx
}

// --------------------------------------------------- a named field write
const o1: unknown = JSON.parse('{"n":1}')
;(o1 as { n: number }).n = 2
console.log("r01", JSON.stringify(o1))

// ------------------------------------------ an index-signature keyed write
const o2: unknown = JSON.parse('{"k":1}')
;(o2 as Record<string, unknown>)["k"] = 2
console.log("r02", JSON.stringify(o2))

// a key the source did not carry at all
const o3: unknown = JSON.parse('{"k":1}')
;(o3 as Record<string, unknown>)["fresh"] = "added"
console.log("r03", JSON.stringify(o3), Object.keys(o3 as Record<string, unknown>).join(","))

// --------------------------------------------------- an array element write
const a1: unknown = JSON.parse("[1,2,3]")
;(a1 as number[])[0] = 9
console.log("r04", JSON.stringify(a1))

// ---------------------------------------------- the in-place array methods
const a2: unknown = JSON.parse("[1,2]")
;(a2 as number[]).push(3)
console.log("r05", JSON.stringify(a2))

const a3: unknown = JSON.parse("[1,2,3]")
;(a3 as number[]).pop()
console.log("r06", JSON.stringify(a3))

const a4: unknown = JSON.parse("[1,2,3]")
;(a4 as number[]).reverse()
console.log("r07", JSON.stringify(a4))

const a5: unknown = JSON.parse("[3,1,2]")
;(a5 as number[]).sort((x: number, y: number): number => x - y)
console.log("r08", JSON.stringify(a5))

const a6: unknown = JSON.parse("[1,2,3]")
;(a6 as number[]).splice(1, 1)
console.log("r09", JSON.stringify(a6))

const a7: unknown = JSON.parse("[2,3]")
;(a7 as number[]).unshift(1)
console.log("r10", JSON.stringify(a7))

const a8: unknown = JSON.parse("[1,2,3]")
;(a8 as number[]).shift()
console.log("r11", JSON.stringify(a8))

// ------------------------------------------------------------- delete
const o4: unknown = JSON.parse('{"k":1,"j":2}')
delete (o4 as Record<string, unknown>)["k"]
console.log("r12", JSON.stringify(o4), Object.keys(o4 as Record<string, unknown>).length)

// ------------------------------------------------------- Object.assign
// Object.assign's whole contract is that it mutates the TARGET and returns
// it. A recovery mutated a fresh struct and returned that, so neither half
// of the contract held for the object the program still named.
//
// Only the TARGET is read back here. The RETURN value is deliberately not:
// tsc types `Object.assign(t, {j: 2})` as an INTERSECTION
// (`Record<string, unknown> & { j: number }`), and recovering an
// intersection emits the DECLARED field ahead of the index-signature keys
// regardless of the source object's own insertion order — so
// `d as Record<string, unknown> & { j: number }` over `{"k":1,"j":2}`
// answers `{"j":2,"k":1}` on both backends where Node answers `{"k":1,"j":2}`.
// That is a separate, older defect in the recovery's key order, it has
// nothing to do with the assertion reroute this file pins, and it is
// reachable with no Object.assign in sight. It is pinned as its own row in
// tests/harness/dyn-asserted-mutation.test.ts and written up in
// estado-fence.md; a byte-compared corpus file cannot carry a row that
// does not match.
const o5: unknown = JSON.parse('{"k":1}')
Object.assign(o5 as Record<string, unknown>, { j: 2 })
console.log("r13", JSON.stringify(o5), Object.keys(o5 as Record<string, unknown>).join(","))

// --------------------------- the asserted type that was ALREADY dynamic
// The one row of the family that was always right: `unknown[]` keeps the
// receiver a ScrDyn, so no recovery ever happened. It is here so that a
// change which reroutes the others cannot quietly break the one that worked.
const a9: unknown = JSON.parse("[1,2]")
;(a9 as unknown[]).push(3)
console.log("r14", JSON.stringify(a9))

// ------------------------------- zapo's own quoted-reply shape, one deep
// A keyed read out of a dyn, asserted to a carrier record, written through.
// This is the row 5630's header names as the one that "diverges", written
// out here now that it does not.
const message: unknown = JSON.parse('{"extendedTextMessage":{"text":"hi"}}')
const mkey = "extendedTextMessage"
const v = (message as Record<string, unknown>)[mkey]
;(v as Carrier).contextInfo = { stanzaId: "X", participant: "p@s" }
console.log("r15", JSON.stringify(message))

// the same read a second time hands back the mutation, because there is only
// one object
const v2 = (message as Record<string, unknown>)[mkey]
const c2 = (v2 as Carrier).contextInfo
console.log("r16", c2 === undefined ? "lost" : String(c2.stanzaId))

// ------------------------------------------- two writes through two routes
const shared: unknown = JSON.parse('{"a":{"text":"t"}}')
;((shared as Record<string, unknown>)["a"] as Carrier).contextInfo = { stanzaId: "Y" }
;((shared as Record<string, unknown>)["a"] as Carrier).text = "changed"
console.log("r17", JSON.stringify(shared))

// ----------------------------------------------- a nested array in an object
const nested: unknown = JSON.parse('{"xs":[1,2]}')
;((nested as Record<string, unknown>)["xs"] as number[]).push(3)
console.log("r18", JSON.stringify(nested))

// ---------------------------------------- the write's own value semantics
// The keyed write evaluates to the assigned value in JS, and a write of a
// composite stores that composite, not a snapshot of it.
const o6: unknown = JSON.parse('{"k":1}')
const inner: Ctx = { stanzaId: "Z" }
;(o6 as Record<string, unknown>)["ctx"] = inner
console.log("r19", JSON.stringify(o6))

// ------------------------------------- fill and copyWithin, in place
// Both answer THE RECEIVER, not a copy, so each row prints the method's own
// result as well as the dyn read back through its name. Negative, absent and
// out-of-range indices are the arms most likely to drift from the static
// tier's own copyWithin table (packages/runtime/test/test_array.c).
const fa1: unknown = JSON.parse("[1,2,3]")
;(fa1 as number[]).fill(0)
console.log("r20", JSON.stringify(fa1))

const fa2: unknown = JSON.parse("[1,2,3,4,5]")
console.log("r21", JSON.stringify((fa2 as number[]).fill(9, 1, 3)), JSON.stringify(fa2))

const fa3: unknown = JSON.parse('["a","b","c","d"]')
console.log("r22", JSON.stringify((fa3 as string[]).fill("z", -2)), JSON.stringify(fa3))

const fa4: unknown = JSON.parse("[1,2,3,4,5]")
console.log("r23", JSON.stringify((fa4 as number[]).copyWithin(0, 3)), JSON.stringify(fa4))

const fa5: unknown = JSON.parse("[1,2,3,4,5]")
console.log("r24", JSON.stringify((fa5 as number[]).copyWithin(1, 0, 3)), JSON.stringify(fa5))

// the no-op arms: a target past the end, a start past the end, an empty run
const fa6: unknown = JSON.parse("[1,2,3]")
console.log(
  "r25",
  JSON.stringify((fa6 as number[]).fill(7, 10)),
  JSON.stringify((fa6 as number[]).copyWithin(0, 9)),
  JSON.stringify((fa6 as number[]).copyWithin(0, 2, 1)),
)

// a negative target clamps to 0, and the source run is retained before any
// store so an OVERLAPPING copy cannot free a slot it has still to read
const fa7: unknown = JSON.parse('[{"v":1},{"v":2},{"v":3},{"v":4}]')
console.log("r26", JSON.stringify((fa7 as Array<{ v: number }>).copyWithin(-100, 1)))

console.log("r99 still running")
