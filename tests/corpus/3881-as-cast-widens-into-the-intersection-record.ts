// `x as (T & { m?: … })` — the CAST spelling of the slot.
//
// An intersection maps to a record with the MERGED fields, and every
// position that MEETS that record already reshapes into it: an annotated
// const and a declared parameter both run coerceToExpected -> widthCoerce,
// which copies the shared fields and completes a field the operand's shape
// does not carry to its undefined arm. That completion is only ever offered
// for an OPTIONAL-flavored member — a required one has no undefined arm and
// the pair declines — so it can never invent a member the type says must
// be there.
//
// The `as` cast had no conversion at all. It erased, which left the
// OPERAND's record where the read resolved against the ASSERTED one, and
// the member read fell to the last-resort fence:
//
//   SC1090 reading 'destroy' from a value of type 'W<Store>'
//
// zapo spells it three times, once per store cache:
//
//   await (backend as WithDestroyLifecycle<WaIdentityStore>).destroy?.()
//
// r01-r04 are the rows that fenced on main. r05-r10 are the controls: the
// two spellings that already answered and must answer identically (r05,
// r06), the base-member read through the same widening cast that already
// compiled (r07), a NARROWING cast, which keeps erasure and is pinned by
// an ALIASING observation that a copy would break (r08), a same-shape cast
// (r09), a widening cast that copies a PRESENT optional member while
// completing an absent one (r10), and a value that really carries the
// member, whose call really runs (r11).

type Store = {
    readonly get: (k: string) => number
}
type WithDestroy<T> = T & { readonly destroy?: () => Promise<void> }
type WithLabel<T> = T & { readonly label?: string }

const plain: Store = { get: (k: string): number => k.length }

// r01 — the zapo shape exactly: an optional FUNCTION member read off the
// cast and invoked through `?.()`. The operand's shape has no such field,
// so the completion answers the undefined arm and the call short-circuits.
async function shutdown(b: Store): Promise<string> {
    await (b as WithDestroy<Store>).destroy?.()
    return "ok" + String(b.get("ab"))
}

// r02 — the same read taken as a VALUE rather than called.
function hasDestroy(b: Store): boolean {
    return (b as WithDestroy<Store>).destroy !== undefined
}

// r03 — an optional DATA member (not a function) off the same kind of cast.
function labelOf(b: Store): string {
    const l = (b as WithLabel<Store>).label
    return l === undefined ? "<none>" : l
}

// r04 — the cast's operand is a CALL RESULT rather than an identifier, so
// the reshape has to sit on a temporary.
function mk(): Store {
    return { get: (k: string): number => k.length * 2 }
}
function labelOfFresh(): string {
    const l = (mk() as WithLabel<Store>).label
    return l === undefined ? "<none>" : l
}

async function main(): Promise<void> {
    console.log("r01 " + (await shutdown(plain)))
    console.log("r02 " + String(hasDestroy(plain)))
    console.log("r03 " + labelOf(plain))
    console.log("r04 " + labelOfFresh())

    // r05 — CONTROL, the annotated-const spelling of the same conversion.
    // It compiled before this rule existed and answers the same thing.
    const asConst: WithLabel<Store> = plain
    console.log("r05 " + (asConst.label === undefined ? "<none>" : asConst.label))

    // r06 — CONTROL, the declared-parameter spelling.
    const viaParam = (x: WithLabel<Store>): string => (x.label === undefined ? "<none>" : x.label)
    console.log("r06 " + viaParam(plain))

    // r07 — CONTROL: a BASE member read through the very same widening
    // cast. This compiled on main through erasure and must keep answering
    // the operand's own value.
    console.log("r07 " + String((plain as WithDestroy<Store>).get("abcd")))

    // r08 — CONTROL: a NARROWING cast keeps ERASURE, and the check is an
    // ALIASING one, because a reshape is exactly what would break it. The
    // cast reads the LIVE object, so the mutation is visible through it;
    // a copy here would answer the pre-mutation 1.
    //
    // (Binding that cast to a `const` is a different position and DOES
    // reshape — the declared-type width copy, the documented "structural
    // width subtyping copies" divergence. That position is untouched here
    // and is not what this row measures.)
    const wide: { n: number; tag: string } = { n: 1, tag: "t" }
    wide.n = 9
    console.log("r08 " + String((wide as { n: number }).n) + " " + String(wide.tag))

    // r09 — CONTROL: a cast to the SAME shape is not a widening and stays
    // erasure.
    const same = plain as Store
    console.log("r09 " + String(same.get("xyz")))

    // r10 — a widening cast that both COPIES a present optional member and
    // COMPLETES an absent one: the operand carries `label`, the asserted
    // shape adds `destroy`.
    const labelled: WithLabel<Store> = { get: (k: string): number => k.length, label: "L" }
    const both = labelled as Store & { readonly label?: string; readonly destroy?: () => Promise<void> }
    console.log(
        "r10 " + (both.label === undefined ? "<none>" : both.label) + " " + String(both.destroy !== undefined),
    )

    // r11 — the member really is there and really runs: nothing about the
    // completion rule may reach a value that carries the field.
    const rich: WithDestroy<Store> = {
        get: (k: string): number => k.length,
        destroy: async (): Promise<void> => {
            console.log("r11 destroy ran")
        },
    }
    await (rich as WithDestroy<Store>).destroy?.()
    console.log("r11 " + String((rich as WithDestroy<Store>).destroy !== undefined))
}

void main()
