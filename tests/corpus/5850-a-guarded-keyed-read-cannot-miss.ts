// A keyed read whose key a DOMINATING GUARD already proved present.
//
// This is zapo's most common statement, twenty-six times over, and it was
// the largest single population of ABORT.real left after the lookup TABLE
// and the `<enc>` switch were closed:
//
//     if (input.node.attrs.id) {
//         attrs.id = input.node.attrs.id      // <- an ABORT.real call site
//     }
//                                 transport/node/builders/global.ts:111-112
//
// The GUARD is already served: `ensureBool` routes a keyed read through
// `recordKeyReadAtSlotWidth(e, DYN)` and answers `false` on a miss. The
// GUARDED read is a fresh `recordKeyGet` at the checker's bare `string` one
// token later, and it still carried the trap — `recordKeyGetHelper`'s miss
// path is `scr_trap_fmt`, an uncatchable process abort past every catch
// clause, with no [SCxxxx] tag on it.
//
// The trap itself cannot go: the helper is INTERNED per (shape, width) and
// shared with the reads that really CAN miss, so deleting it there trades a
// loud failure for a wild pointer on those. What moves is the CALL SITE:
// the guarded read lowers at DYN width, whose miss answers `undefined`, and
// `maybeNarrow` bridges back to the checker's own scalar through the
// ordinary validated `dynCheck`. On a hit — every execution the guard
// admits — the value is the one the bare read always answered, which is
// what every row below asserts against Node.
//
// Dial: `SCRIPTC_GUARDKEY_OFF=1` ablates the rule alone, and every guarded
// row below goes back to the aborting width while every control stays
// byte-identical.

type Attrs = Record<string, string>
type Nums = Record<string, number>

const A: Attrs = { id: "i1", from: "f1", participant: "p1", type: "t1", empty: "" }
const N: Nums = { one: 1, two: 2 }
const R: Attrs = { type: "retry", from: "f2" }

// ------------------------------------------------ 1. the truthiness guard
function r01(a: Attrs): string {
    if (a.id) {
        return a.id
    }
    return "none"
}

// ------------------------------- 2. the BRACKET spelling of the same read
function r02(a: Attrs): string {
    if (a["id"]) {
        return a["id"]
    }
    return "none"
}

// ---------------------------- 3. a COMPUTED key, the same binding on both
function r03(a: Attrs, k: string): string {
    if (a[k]) {
        return a[k]
    }
    return "none"
}

// -------------------------------- 4. the dot guard, the bracket read (one
//    read written two ways is still one read)
function r04(a: Attrs): string {
    if (a.from) {
        return a["from"]
    }
    return "none"
}

// ----------------------------------------------- 5. `!== undefined`
function r05(a: Attrs): string {
    if (a.participant !== undefined) {
        return a.participant
    }
    return "none"
}

// ----------------------------------------------- 6. `!= null`
function r06(a: Attrs): string {
    if (a.type != null) {
        return a.type
    }
    return "none"
}

// ----------------------------------------------- 7. `typeof !== 'undefined'`
function r07(a: Attrs): string {
    if (typeof a.id !== "undefined") {
        return a.id
    }
    return "none"
}

// ------------------------------- 8. the ELSE branch of an `=== undefined`
function r08(a: Attrs): string {
    if (a.from === undefined) {
        return "none"
    } else {
        return a.from
    }
}

// ---------------------------------------- 9. the else branch of a `!` test
function r09(a: Attrs): string {
    if (!a.type) {
        return "none"
    } else {
        return a.type
    }
}

// --------------------------------------------- 10. the `&&` right operand
function r10(a: Attrs): string {
    return a.id && a.id.length > 0 ? a.id : "none"
}

// ------------------------------------------- 11. the ternary's TRUE arm
function r11(a: Attrs): string {
    return a.participant ? a.participant : "none"
}

// ------------------------------------------- 12. the ternary's FALSE arm
function r12(a: Attrs): string {
    return !a.from ? "none" : a.from
}

// ---------------------------------- 13. the `||` right operand, negated
function r13(a: Attrs): string {
    if (!a.type || a.type.length === 2) {
        return a.type === undefined ? "none" : "short"
    }
    return "long"
}

// ------------------------------------- 14. a NUMBER-valued record
function r14(n: Nums): number {
    if (n.one !== undefined) {
        return n.one + 10
    }
    return -1
}

// ------------------------ 15. a NESTED receiver chain, two levels of guard
function r15(box: { readonly a: Attrs }): string {
    if (box.a.id) {
        if (box.a.from) {
            return box.a.id + "/" + box.a.from
        }
        return box.a.id
    }
    return "none"
}

// --------------------------- 16. a guard whose value is FALSY but PRESENT.
//     The truthiness test proves more than presence, so this row takes the
//     else branch on both runtimes — it is here so the rule's proof and the
//     program's control flow are not confused for one another.
function r16(a: Attrs): string {
    if (a.empty) {
        return "truthy:" + a.empty
    }
    return "falsy"
}
//     ...and the presence test that DOES admit it.
function r17(a: Attrs): string {
    if (a.empty !== undefined) {
        return "present:[" + a.empty + "]"
    }
    return "absent"
}

// ------------------- 18. the key came out of the receiver's OWN for-in
//     enumeration — `WaMediaTransferClient.ts:91` and `:375` are this, and
//     the proof is the loop, not a guard.
function r18(headers: Attrs): string {
    let out = ""
    for (const key in headers) {
        out += key + "=" + headers[key] + ";"
    }
    return out
}


// ------------------ 19. `typeof <read> === '<kind>'` — WaBotCoordinator.ts:204
function r19(a: Attrs): string {
    return typeof a.id === "string" ? a.id : "none"
}

// ------- 20. an equality against a value that cannot be undefined, in BOTH
//     disjuncts of a true `||` — retry/parse.ts:77-80 is exactly this.
const T_RETRY = "retry"
const T_REKEY = "rekey"
function r20(a: Attrs): string {
    return a.type === T_RETRY || a.type === T_REKEY ? a.type : "none"
}


// -------------- 21. `typeof <read> === 'undefined'` — the FALSE arm proves
//     presence just as `!== 'undefined'` proves it in the true one.
function r21(a: Attrs): string {
    return typeof a.id === "undefined" ? "none" : a.id
}

// ---------------------------------------------------------- THE CONTROLS
// Every control below must keep the lowering it had. None of them can be
// proven by a guard, and each one is a way a naive rule would go wrong.

// C1 — a guard on a DIFFERENT key. The read is present anyway, so the
//      program agrees with Node either way; what matters is that the rule
//      does not claim it.
function c01(a: Attrs): string {
    if (a.id) {
        return a.from
    }
    return "none"
}

// C2 — a guard on a different RECEIVER.
function c02(a: Attrs, b: Attrs): string {
    if (b.id) {
        return a.id
    }
    return "none"
}

// C3 — the guarded region REASSIGNS the receiver's root.
function c03(a: Attrs, b: Attrs): string {
    let r = a
    if (r.id) {
        r = b
        return r.id
    }
    return "none"
}

// C4 — the guarded region DELETES.
function c04(a: Attrs): string {
    const copy: Attrs = { ...a }
    if (copy.id) {
        delete copy.from
        return copy.id
    }
    return "none"
}

// C5 — an OPTIONAL-CHAIN guard is a different evaluation.
function c05(a: Attrs | undefined): string {
    if (a?.id) {
        return a.id
    }
    return "none"
}

// C6 — a read with NO guard at all, at a destination that already arms it
//      (the `??` rung): an absent key answers the default, and always did.
function c06(a: Attrs): string {
    return a.missing ?? "default"
}

// C7 — a read guarded by a test on a LOCAL that merely holds the read. The
//      binding rung already widens this one; the rule here must not double
//      up on it.
function c07(a: Attrs): string {
    const v = a.id
    if (v) {
        return v
    }
    return "none"
}

// C8 — a read inside a NESTED function does not inherit the guard around
//      the function (the closure runs later, when the proof is stale —
//      tsc's own invalidation rule, and the array/instanceof rules').
function c08(a: Attrs): string {
    if (a.id) {
        const probe = (): number => a.id.length
        return probe() > 0 ? a.id : "empty"
    }
    return "none"
}


// C9 — the key came out of a DIFFERENT object's enumeration.
function c09(a: Attrs, b: Attrs): string {
    let out = ""
    for (const key in b) {
        out += (a[key] ?? "?") + ";"
    }
    return out
}


// C10 — only ONE disjunct of a true `||` proves the key. Nothing is
//       established, and the read keeps its lowering.
function c10(a: Attrs): string {
    return a.type === T_RETRY || a.from === "x" ? a.type : "none"
}

// C11 — the `=== undefined` TRUE arm proves ABSENCE, so the read inside it
//       keeps its lowering. (Its ELSE arm is r09/r21's shape and IS proven —
//       the two arms of one test land on opposite sides of this rule.)
function c11(a: Attrs): string {
    if (a.missing === undefined) {
        return a.missing
    }
    return "present"
}


console.log(r01(A), r02(A), r03(A, "id"), r04(A), r05(A), r06(A), r07(A))
console.log(r08(A), r09(A), r10(A), r11(A), r12(A), r13(A))
console.log(r14(N), r15({ a: A }), r16(A), r17(A), r18(A), r18({}), r19(A), r19({}), r20(A), r20(R), c10(R), r21(A), r21({}))
console.log(c01(A), c02(A, A), c03(A, A), c04(A), c05(A), c06(A), c07(A), c08(A), c09(A, A), c10(A), c11({ missing: "m" }))
console.log(r01({}), r05({}), r08({}), r11({}), r14({}), r16({}), r17({}))
console.log(c05(undefined), c06({}))

export {}
