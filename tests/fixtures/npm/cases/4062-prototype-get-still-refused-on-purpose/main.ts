// ON PURPOSE: the two things the record walkers' [[Get]] still does not
// answer. Neither is a fence, so `coverage` reports this program fully
// static and no trap census can see either -- the same invisibility that
// made 4031 dangerous. The pin exists so the next block gets the ORDER.
//
// 1. A prototype ACCESSOR. The walkers' read is borrow-only by contract
//    (`scr_dyn_obj_own_data` + `scr_dyn_proto_get`, the pair the coercion
//    protocols already ask): a matcher returns bool and a builder runs
//    before the record exists, so neither holds an exception path for a
//    throwing getter -- and both would run it, so a cast would call the
//    getter TWICE where JS calls it once. Node answers `1 42`.
//
// 2. A union arm whose record shape carries a METHOD. This is zapo's
//    `notAfter?: number | Long | null` exactly, and it is the wall behind
//    the SC2001 at spec/proto/index.js:1 -- NOT the own-only read, which
//    4061's `union-arm-inherited-data` proves is gone. The matcher's func
//    leaf is an EXACT signature test (`strcmp(d->v.fn.sig, "func()=>f64")`)
//    and a shipped package's untyped `L.prototype.toNumber` is boxed
//    `func()=>dyn`, so the arm cannot match however the member is read.
//    The strictness is deliberate and documented at the emitter: matching
//    on callable-KIND alone would make `{a: () => number} | {a: () => string}`
//    take arm 0 for a string-returning value. Relaxing it needs
//    union-level ambiguity analysis, which is a different change from
//    this one, so it is priced here rather than taken.
//
// 3. The record -> dyn ROUND TRIP does not preserve own-ness. A checked
//    cast MATERIALIZES a record struct, and converting that back to a dyn
//    writes every declared field as an OWN enumerable key -- so an
//    inherited member re-emerges as an own one and JSON.stringify,
//    Object.keys and for-in all see it. That is a pre-existing property
//    of record materialization (JS has no materialization step at all:
//    `x as T` is the identity), and reading the prototype is what first
//    makes it REACHABLE, which is why it is named here rather than left
//    for the next reader to find. On base the same program dies one line
//    earlier with `expected number at $.w, got undefined`.
import { makeGetter, make, makeData } from "protolong"

interface GetterLike { low: number; hi: number }
interface LongLike { low: number; high: number; unsigned: boolean; toNumber(): number }
interface DataLike { z: number; w: number }

type Slot = number | LongLike | null

function t(name: string, f: () => string): void {
    try {
        console.log(name, f())
    } catch {
        console.log(name, "THREW")
    }
}

t("prototype-accessor", () => {
    const v = makeGetter() as GetterLike
    return `${v.low} ${v.hi}`
})

function show(s: Slot): string {
    if (s === null) return "null"
    if (typeof s === "number") return `num ${s}`
    return `long ${s.toNumber()}`
}
t("union-arm-with-method", () => show(make(7, 0) as Slot))

t("roundtrip-owns-the-inherited", () => {
    const v = makeData(9) as DataLike
    return `${v.z} ${v.w} ${JSON.stringify(v as unknown)}`
})
