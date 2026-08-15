// A checked-dynamic value the checker narrowed to `bigint` is extracted like
// every other scalar.
//
// maybeNarrow bridges a dyn read tsc narrowed to a SCALAR with a validated
// dynCheck — the checked-cast machinery — rather than a trusted peek. Its
// list of scalars read f64 | bool | string, and `bigint` was missing from it,
// so a value guarded by `typeof v === 'bigint'` stayed dyn and the next line
// refused it:
//
//     'Number of unknown values' is part of the standard library types but
//     has no scriptc lowering yet                                    SC2020
//
// Nothing else was missing. `typeof v === "bigint"` is a REAL runtime test
// (SCR_DYN_BIG; the constant fold that used to stand there was removed for
// being a silent wrong answer), and `v as bigint` already extracted one
// through this very dynCheck — r09/r10 are that route, and they compiled on
// main. Only the bridge between the guard and the extraction was absent.
//
// Widening that list is NOT free, and corpus 3542 is the fixture that says
// so: it was written by the block that tried this, measured the loss and
// declined. A dyn argument is strictly more capable than a static one for at
// least one consumer — JSON.stringify, whose runtime walker reaches the
// BigInt case and throws V8's own "Do not know how to serialize a BigInt"
// (Node's answer) while the static bigint arm is a compile-time refusal of a
// program that ran. 3542 prices the widening at "an audit of every consumer
// that special-cases kind === 'dyn' and has no bigint arm, routed back
// through narrowBridgeDyn".
//
// That audit is r15-r17 here, and the corpus is the instrument: of 54
// bigint- or Promise.resolve-bearing corpus programs the widened rule fires
// in four, and exactly ONE consumer regressed — JSON.stringify. It now asks
// for the dyn underneath, gated on jsonSafe so it can only turn a refusal
// into the dyn path. 3542 is byte-identical to Node again, on both tiers.
//
// r01-r08 are the rows that fail to build on main. r09-r14 are controls:
// the explicit-cast route that already worked (r09/r10), the scalars that
// were already in the list (r11/r12/r13), and the guard actually guarding —
// a non-bigint argument must still take the fall-through arm (r14). r15-r17
// are 3542's property, restated at this file's own shapes.

// r01 — the zapo spelling: Number() of a typeof-narrowed unknown.
function asNumber(value: unknown, field: string): number {
    if (typeof value === "number") {
        return value
    }
    if (typeof value === "bigint") {
        return Number(value)
    }
    throw new Error("invalid number value for " + field)
}
console.log("r01 " + String(asNumber(42n, "a")))

// r02 — a member call on the narrowed value.
function asText(value: unknown): string {
    if (typeof value === "bigint") {
        return value.toString()
    }
    return "not-a-bigint"
}
console.log("r02 " + asText(1234567890123456789n))

// r03 — arithmetic through the narrow: the extraction has to hand back a real
// bigint, not a box, or the operator has nothing to work on.
function doubled(value: unknown): string {
    if (typeof value === "bigint") {
        return String(value * 2n + 1n)
    }
    return "-"
}
console.log("r03 " + doubled(21n))

// r04 — a comparison through the narrow.
function positive(value: unknown): boolean {
    if (typeof value === "bigint") {
        return value > 0n
    }
    return false
}
console.log("r04 " + String(positive(5n)) + " " + String(positive(-5n)))

// r05 — the guard as an early return: tsc narrows the REST of the body, which
// is a different control-flow shape reaching the same bridge.
function afterEarlyReturn(value: unknown): string {
    if (typeof value !== "bigint") {
        return "other"
    }
    return String(value + 10n)
}
console.log("r05 " + afterEarlyReturn(32n) + " " + afterEarlyReturn("s"))

// r06 — the guard inside a `&&`, narrowing the right operand.
function conjunct(value: unknown): string {
    return typeof value === "bigint" && value > 100n ? "big" : "small"
}
console.log("r06 " + conjunct(1000n) + " " + conjunct(1n) + " " + conjunct("x"))

// r07 — the narrowed value crossing back into a template literal.
function label(value: unknown): string {
    if (typeof value === "bigint") {
        return `n=${value}`
    }
    return "n=?"
}
console.log("r07 " + label(9n))

// r08 — a bigint reached through an array of unknowns: every element takes the
// guard, and only some of them are bigints.
function sumBigints(values: readonly unknown[]): string {
    let total = 0n
    for (const v of values) {
        if (typeof v === "bigint") {
            total += v
        }
    }
    return String(total)
}
console.log("r08 " + sumBigints([1n, "x", 2n, 3, true, 4n]))

// r09 — CONTROL: the explicit checked cast, which is the route that already
// compiled and is the proof the extraction machinery predates this change.
function viaCast(value: unknown): number {
    if (typeof value === "bigint") {
        const b = value as bigint
        return Number(b)
    }
    return -1
}
console.log("r09 " + String(viaCast(7n)) + " " + String(viaCast("s")))

// r10 — CONTROL: the same cast inline.
function viaCastInline(value: unknown): string {
    return typeof value === "bigint" ? (value as bigint).toString() : "-"
}
console.log("r10 " + viaCastInline(8n))

// r11 — CONTROL: the string scalar, already in the list.
function asStr(value: unknown): number {
    if (typeof value === "string") {
        return Number(value)
    }
    return -1
}
console.log("r11 " + String(asStr("41")))

// r12 — CONTROL: the number scalar, already in the list.
function asNum(value: unknown): number {
    if (typeof value === "number") {
        return value + 1
    }
    return -1
}
console.log("r12 " + String(asNum(41)))

// r13 — CONTROL: the boolean scalar, already in the list.
function asBool(value: unknown): string {
    if (typeof value === "boolean") {
        return value ? "yes" : "no"
    }
    return "-"
}
console.log("r13 " + asBool(true) + " " + asBool(0))

// r14 — CONTROL: the guard still guards. Every non-bigint argument must take
// the fall-through arm, and a bigint-looking NUMBER is not a bigint.
console.log("r14 " + asText(7) + " " + asText("7") + " " + asText(null) + " " + asText(undefined))

// r15 — THE AUDIT ROW. JSON.stringify of the narrowed value must still reach
// the runtime's dyn walker and throw V8's own message, not refuse at compile
// time. This is the row 3542 predicted would go red, and the one the
// jsonSafe-gated narrowBridgeDyn in the JSON lowering exists for.
function jsonOf(value: unknown): string {
    if (typeof value === "bigint") {
        try {
            return "ok:" + JSON.stringify(value)
        } catch (e) {
            return "threw:" + String(e instanceof TypeError) + ":" + (e as Error).message
        }
    }
    return "not-bigint"
}
console.log("r15 " + jsonOf(5n))

// r16 — the other consumers 3542 lists, at this file's own shapes: each has
// a bigint arm of its own and must keep printing Node's spelling (`9n`, not
// `9`), which is the check that the extraction did not quietly change what
// gets printed.
function shows(value: unknown): void {
    if (typeof value === "bigint") {
        console.log("r16", value, [value], { v: value })
        return
    }
    console.log("r16 -")
}
shows(9n)

// r17 — the same JSON row with NO guard at all, so the property is pinned
// independently of the bridge: a bigint that reached `unknown` unguarded
// takes the walker too.
const unguarded: unknown = BigInt(4)
try {
    console.log("r17 ok:" + JSON.stringify(unguarded))
} catch (e) {
    console.log("r17 threw:" + String(e instanceof TypeError))
}
