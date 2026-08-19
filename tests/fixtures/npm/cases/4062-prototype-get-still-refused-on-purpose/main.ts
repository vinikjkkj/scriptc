// ON PURPOSE: the things the record walkers' [[Get]] still does not
// answer. Neither remaining one is a fence, so `coverage` reports this
// program fully static and no trap census can see either -- the same
// invisibility that made 4031 dangerous. The pin exists so the next block
// gets the ORDER.
//
// 1. CLOSED. A prototype ACCESSOR. The walkers' read is borrow-only by
//    contract (`scr_dyn_obj_own_data` + `scr_dyn_proto_get`, the pair the
//    coercion protocols already ask) and this comment used to conclude
//    that neither walker could answer an accessor. Half of that was
//    wrong: the MATCHER returns bool and genuinely cannot, but the
//    BUILDER runs inside a function that already propagates a pending
//    exception after every field, so it holds the +1 and the exception
//    path a getter needs. The builder now asks scr_dyn_obj_accessor_get
//    on the MISS path alone, so a field the data read answered runs no
//    getter, and the "TWICE" objection does not arise either: an
//    accessor-only field is never MATCHED, so a matched arm never
//    reaches the new read and the getter runs exactly once. Node answers
//    `1 42` and so does this, on both backends. What is still open is
//    the matcher: a UNION arm whose record needs an accessor is still
//    not selected (loudly -- `no arm matched`), and closing that needs a
//    presence test that does not run the getter.
//
// 2. A union arm whose record shape carries a METHOD whose VALUE is an
//    untyped JS function. The matcher's func leaf is an EXACT signature
//    test (`strcmp(d->v.fn.sig, "func()=>f64")`) and this package's
//    `L.prototype.toNumber` infers `() => unknown`, so it boxes
//    `func()=>dyn` and the arm cannot match however the member is read.
//    The strictness is deliberate and documented at the emitter: matching
//    on callable-KIND alone would make `{a: () => number} | {a: () => string}`
//    take arm 0 for a string-returning value. Relaxing it needs
//    union-level ambiguity analysis, which is a different change from
//    this one, so it is priced here rather than taken.
//
//    It is NOT zapo's case, and an earlier version of this comment said
//    it was. zapo's declaration is the same strict `toNumber(): number`,
//    but the real `long` package's body uses `>>>0`, so the closure
//    infers `() => number` and boxes `func()=>f64` -- the signature test
//    passes there. 4061's `union-arm-method-typed-number` is that case
//    with one operator as the only difference.
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
