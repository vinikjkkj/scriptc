// The axes JS's [[Get]] has, asked of the emitted record walkers, one
// line each and every one measured against Node v25.9.0 first.
//
// The last one is the UNION arm, and it is a different emitted function
// from the rest: the record MATCHER (`sc_dm_N`, a bool predicate that
// picks the union arm) rather than the record BUILDER. It is the shape
// zapo's `notAfter?: number | Long | null` has, with the METHOD removed
// -- the removal control that separates "the matcher cannot see the
// prototype" from the signature refusal 4062 prices. On base it failed
// with zapo's own message, `expected number | null | object at $, got
// object`.
import { make, makeK, makeHidden, makeShadow, makeDeep, makeBare, makeData } from "protolong"

interface LongLike { low: number; high: number; unsigned: boolean; toNumber(): number }
interface LongDyn { low: number; high: number; unsigned: boolean; toNumber(): unknown }
interface KLike { v: number; twice(): number }
interface HiddenLike { m: number; n: number }
interface ShadowLike { tag: string }
interface DeepLike { z: number; deep(): number }
interface BareLike { low: number; toNumber(): number }
interface DataLike { z: number; w: number }

type Slot = number | DataLike | null

function t(name: string, f: () => string): void {
    try {
        console.log(name, f())
    } catch {
        console.log(name, "THREW")
    }
}

// inherited ENUMERABLE method, called with the receiver bound
t("inherited-enumerable-method", () => {
    const v = make(7, 0) as LongLike
    return `${v.low} ${v.high} ${v.unsigned} ${v.toNumber()}`
})

// inherited NON-ENUMERABLE method -- `enumerable` is about enumeration
t("inherited-nonenumerable-method", () => {
    const v = makeK(21) as KLike
    return `${v.v} ${v.twice()}`
})

// an OWN non-enumerable data property
t("own-nonenumerable-data", () => {
    const v = makeHidden() as HiddenLike
    return `${v.m} ${v.n}`
})

// shadowing: the own member wins
t("shadow-own-wins", () => {
    const v = makeShadow() as ShadowLike
    return v.tag
})

// two prototype levels up
t("two-levels-up", () => {
    const v = makeDeep(9) as DeepLike
    return `${v.z} ${v.deep()}`
})

// a null-prototype dictionary inherits NOTHING: the walk must stop, and
// Node throws here too (`v.toNumber is not a function`)
t("nullproto-inherits-nothing", () => {
    const v = makeBare() as BareLike
    return `${v.low} ${v.toNumber()}`
})

// the UNION ARM: the matcher, not the builder
function show(s: Slot): string {
    if (s === null) return "null"
    if (typeof s === "number") return `num ${s}`
    return `data ${s.z} ${s.w}`
}
t("union-arm-inherited-data", () => show(makeData(9) as Slot))
t("union-arm-number", () => show(5 as unknown as Slot))

// The DISCRIMINATOR for what is left. Same arm as 4062's, same object,
// same everything -- except `toNumber` is declared `(): unknown`, so the
// TARGET signature is `func()=>dyn`, which is what a shipped package's
// untyped function actually boxes as. It matches, the method is called
// with the receiver bound, and it byte-matches Node. So the refusal 4062
// prices is the exact-signature strcmp and nothing else: not the read,
// not the binding, not the arm order.
type DynSlot = number | LongDyn | null
function showDyn(s: DynSlot): string {
    if (s === null) return "null"
    if (typeof s === "number") return `num ${s}`
    return `long ${s.toNumber()}`
}
t("union-arm-method-typed-unknown", () => showDyn(make(7, 0) as DynSlot))
