// `void | undefined` is the VOID mapping, not a two-value choice.
//
// Standalone `void` and standalone `undefined` already mapped to VOID —
// the comment on that rule even says "`(): void | undefined` functions
// must stay void". But when the checker hands out the UNION spelling the
// flag test never fires: the type's flags say Union, so mapping fell into
// the union branch, where both parts fold to the single undefinedT arm and
// a lone unit arm has no union representation. It fenced.
//
// The checker hands out that spelling constantly. `p.catch(h)` is declared
// `catch<TResult>(onrejected: (reason: any) => TResult): Promise<T | TResult>`,
// so `Promise<void>.catch(() => undefined)` binds T = void, TResult =
// undefined and the call's type is `Promise<void | undefined>` — measured,
// not guessed. That is the idiom for "run this, ignore any failure", and
// it is spelled that way all over real code.
//
// Why VOID is exact rather than a widening: both parts are inhabited by
// exactly the value `undefined`, so the type carries no value at all,
// which IS what void means here. `never` parts join because they are
// uninhabited (`T | never` is `T`). NULL deliberately does not: `null`
// and `undefined` are distinguishable at runtime with separate tags, so
// `null | undefined` stays a real two-arm union.
//
// The second half is the handler body. A bare-expression handler over a
// void result lowered as an expression STATEMENT, and `() => undefined`
// lowers to a bare unit literal, which the IR validator refuses outside a
// unionWrap. A unit literal has nothing to evaluate and nothing to return,
// so it contributes no statement; any other expression still runs for its
// effects.
//
// What this pins against Node: the four handler spellings over a
// `Promise<void>` (bare undefined, a parameter, a block body, an annotated
// `(): undefined =>`), the same handler over a `Promise<number>` (whose
// `number | undefined` result already worked and must keep working), the
// success path through each — a handler that never runs must not change
// the value — and a handler with a real side effect, which must still run.

async function failVoid(fail: boolean): Promise<void> {
    if (fail) throw new Error('boom')
}

async function failNum(fail: boolean, v: number): Promise<number> {
    if (fail) throw new Error('boom')
    return v
}

async function bareUndefined(fail: boolean): Promise<void> {
    await failVoid(fail).catch(() => undefined)
    console.log(`bare fail=${fail}`)
}

async function withParameter(fail: boolean): Promise<void> {
    await failVoid(fail).catch((e) => undefined)
    console.log(`param fail=${fail}`)
}

async function blockBody(fail: boolean): Promise<void> {
    await failVoid(fail).catch(() => {})
    console.log(`block fail=${fail}`)
}

async function annotated(fail: boolean): Promise<void> {
    await failVoid(fail).catch((): undefined => undefined)
    console.log(`annot fail=${fail}`)
}

// The T | undefined result: this one already lowered, and is here so a
// regression in the half that worked shows up in the same run.
async function overNumber(fail: boolean): Promise<void> {
    const v = await failNum(fail, 7).catch(() => undefined)
    console.log(`num fail=${fail} -> ${v === undefined ? 'undef' : v}`)
}

// A handler whose body is NOT a unit literal still runs for its effects.
let effects = 0
async function withEffect(fail: boolean): Promise<void> {
    await failVoid(fail).catch(() => bump())
    console.log(`effect fail=${fail} count=${effects}`)
}

function bump(): void {
    effects += 1
}

// A void-returning function declared with the union spelling directly —
// the mapping the rule is named for, reached without any promise at all.
function declaredVoidUnion(n: number): void | undefined {
    if (n > 0) return undefined
    return
}

async function main(): Promise<void> {
    await bareUndefined(true)
    await bareUndefined(false)
    await withParameter(true)
    await withParameter(false)
    await blockBody(true)
    await blockBody(false)
    await annotated(true)
    await annotated(false)
    await overNumber(true)
    await overNumber(false)
    await withEffect(true)
    await withEffect(false)
    await withEffect(true)
    declaredVoidUnion(1)
    declaredVoidUnion(-1)
    console.log(`done effects=${effects}`)
}

await main()
export {}
