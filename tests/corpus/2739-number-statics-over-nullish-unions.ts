// The Number static predicates over a union of a number with NULLISH arms.
//
// `number | undefined` already lowered: the statics never coerce, so the
// absent arm is constantly false, and replacing it with a sentinel the
// predicate reads as false (`?? NaN`, or `?? 0` for isNaN) gives Node's
// answer exactly. The rule was pinned to a TWO-ARM shape, so the moment a
// `null` arm joined — `number | null | undefined`, which is what a
// nullable getter answers — it fell off and fenced.
//
// The generalization is "one number arm, every other arm nullish", and the
// reason it is exact rather than a widening is that `??` catches null and
// undefined AND NOTHING ELSE: the residue handed to the f64 static is
// precisely the number arm. A real NaN survives, because NaN is not
// nullish — which is the case that would otherwise be silently wrong.
//
// What this pins against Node: each of the four predicates over both a
// two-arm and a three-arm nullish union, with the value present, null and
// undefined; a real NaN and both infinities through the same slot (the
// arms a sentinel could be confused with); the values arriving through a
// function return rather than a literal, so nothing is folded; and the
// arms that must KEEP their fence.

type Skew = number | null | undefined

function skewOf(which: number): Skew {
    if (which === 0) return 42
    if (which === 1) return null
    if (which === 2) return undefined
    if (which === 3) return NaN
    if (which === 4) return Infinity
    if (which === 5) return -Infinity
    if (which === 6) return 0
    if (which === 7) return -0
    return 3.5
}

function maybe(which: number): number | undefined {
    if (which === 0) return 7
    if (which === 1) return undefined
    if (which === 2) return NaN
    return Infinity
}

function label(v: Skew): string {
    if (v === null) return 'null'
    if (v === undefined) return 'undef'
    return String(v)
}

function three(): void {
    for (let i = 0; i < 9; i += 1) {
        const v = skewOf(i)
        console.log(
            `t${i} ${label(v)}` +
                ` fin=${Number.isFinite(v)}` +
                ` nan=${Number.isNaN(v)}` +
                ` int=${Number.isInteger(v)}` +
                ` safe=${Number.isSafeInteger(v)}`
        )
    }
}

function two(): void {
    for (let i = 0; i < 4; i += 1) {
        const v = maybe(i)
        console.log(
            `w${i} ${v === undefined ? 'undef' : String(v)}` +
                ` fin=${Number.isFinite(v)}` +
                ` nan=${Number.isNaN(v)}` +
                ` int=${Number.isInteger(v)}` +
                ` safe=${Number.isSafeInteger(v)}`
        )
    }
}

// The shape the wall actually had: a nullable skew folded into a clock
// read, where the predicate is the guard in front of the `as number`.
function clock(getSkewMs: () => Skew, baseMs: number): number {
    const skewMs = getSkewMs()
    return Number.isFinite(skewMs) ? baseMs + (skewMs as number) : baseMs
}

function clocks(): void {
    console.log(`c0 ${clock(() => 250, 1000)}`)
    console.log(`c1 ${clock(() => null, 1000)}`)
    console.log(`c2 ${clock(() => undefined, 1000)}`)
    console.log(`c3 ${clock(() => NaN, 1000)}`)
    console.log(`c4 ${clock(() => Infinity, 1000)}`)
    console.log(`c5 ${clock(() => -0, 1000)}`)
}

// WHAT KEEPS ITS FENCE, and is therefore not written here as a compiled
// assertion — each verified by watching the build refuse it:
//   - an argument with NO number arm ("Number.isFinite of 'null |
//     undefined' values"): the answer is the constant false, and the
//     rewrite has nothing to hand the static.
//   - an argument with a non-nullish extra arm (`number | string`): `??`
//     would let the string through untyped as f64. JS says false for it;
//     that is a real question this rewrite cannot answer, so it stays
//     refused with the narrow-first hint.

three()
two()
clocks()
