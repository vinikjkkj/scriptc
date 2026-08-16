// `void e` in VALUE position, where `e` has effects.
//
// `void e` is `(e, undefined)`. The comma operator's own lowering has
// carried that shape as a seqExpr all along; the void operator refused it,
// on the stated ground that "the effect would need to sequence before it,
// which no expression shape carries". It does carry it, four hundred lines
// down in the same file.
//
// The BUNDLE row is why: protobufjs's spec/proto/index.js has 4062 `void `
// occurrences and exactly ONE that is not `void 0` -- at byte offset 34551,
//
//     catch(e){ return s.emit("error",e,t), void setTimeout(function(){a(e)},0) }
//
// a comma expression in a RETURN whose right operand is `void <call>`.
// Row 5 is that shape.
//
// CONTROLS: rows 1 and 2 are the side-effect-FREE operand (`void 0`), which
// folded to the unit literal before this and must keep folding -- a change
// that routed them through the sequence instead would be building a
// seqExpr where a constant belongs. Row 9 pins that the operand runs
// EXACTLY ONCE: the whole hazard of a sequence lowering is duplicating the
// operand.
//
// NOT A ROW HERE, and a price this lowering CREATES: `void <effectful>`
// answers a VOID-typed value -- which is what lets unionWrap's existing
// VOID-payload rule ("evaluate for effects, produce the interned unit
// instance") carry it unchanged -- and a TERNARY may not be void-typed.
// So `flag ? void eff() : void 0` is "'undefined' values where 'void' is
// expected", and `flag ? void eff("c") : void eff("d")` is the validator's
// "ternary must not be void". Row 7 is the if/else spelling of the same
// thing, which compiles. The base refused the whole expression on the
// effectful operand alone, so nothing that compiled before stops
// compiling -- but the ternary is a real limit and it is written down
// here rather than left for the next block to rediscover.
//
// NOT A ROW HERE, and still a price: an operand whose statement lowering
// needs real CONTROL FLOW. `seqExprSafeStmt` admits straight-line writes
// only -- the C emission point is mid-expression -- so that operand keeps
// a refusal, now a pointed one naming control flow. It is the same
// refusal the comma operator gives for the same reason, and it cannot be
// a row here because a corpus fixture has to match Node byte for byte.

let effects = ""
function eff(tag: string): number {
    effects += tag
    return tag.length
}
function later(f: () => void, ms: number): void {
    effects += "L" + ms
    f()
}
function emitted(tag: string): boolean {
    effects += "E" + tag
    return true
}

// 1. CONTROL: the pure operand still folds to the unit
const pure: undefined = void 0
console.log("pure      " + typeof pure)

// 2. CONTROL: the inferred spelling of the same
const pure2 = void 0
console.log("pure2     " + String(pure2 === undefined))

// 3. an effectful operand into an inferred const
const r3 = void eff("a")
console.log("const     " + typeof r3)

// 4. an effectful operand into a union-typed parameter slot
function widen(x: number | undefined): string {
    return x === undefined ? "undef" : "num" + x
}
console.log("argument  " + widen(void eff("b")))

// 5. THE BUNDLE'S SHAPE: `return <comma>, void <call>` out of a function
//    whose return type is the unit
function scheduleThenNothing(tag: string): undefined {
    return (emitted(tag), void later(() => { effects += "C" }, 0))
}
const r5 = scheduleThenNothing("x")
console.log("bundle    " + typeof r5)

// 6. the operand is a void-returning call, so no discard is needed at all
function nothing(): void { effects += "N" }
const r6 = void nothing()
console.log("voidcall  " + typeof r6)

// 7. under a branch, where the value is genuinely consumed on each side
const flag = effects.length > 0
if (flag) {
    console.log("branch    " + widen(void eff("c")))
} else {
    console.log("branch    " + widen(void eff("d")))
}

// 8. an effectful operand that is an assignment, not a call
let counter = 0
const r8 = void (counter = 41 + 1)
console.log("assign    " + typeof r8 + " " + counter)

// 9. the operand runs EXACTLY ONCE -- the whole hazard of a sequence
//    lowering is duplicating it
let once = 0
function bump(): number { once += 1; return once }
const r9 = void bump()
console.log("once      " + typeof r9 + " " + once)

// 10. the accumulated effect string pins the ORDER as well as the count
console.log("effects   " + effects)
