// `r[k]` where k's checker type is a UNION of string literals naming
// declared fields whose types DIFFER — the provider-registry shape
// (`backend[kind]` with kind: 'stores' | 'caches'). tsc's keyof check
// proved membership and typed the access as the union of exactly those
// fields' types; the read lowers to an interned equality dispatch — one
// string test per named field, each arm the plain field read wrapped
// into its union arm. Receiver and key evaluate ONCE (the effectful-key
// stanza pins it), exactly JS's evaluation order.
type Registry = {
    readonly stores: { readonly tag: string; readonly n: number }
    readonly caches: { readonly tag: string; readonly deep: { readonly d: number } }
}

const reg: Registry = {
    stores: { tag: 's', n: 1 },
    caches: { tag: 'c', deep: { d: 9 } }
}

function read(kind: 'stores' | 'caches'): string {
    const v = reg[kind]
    if (kind === 'stores') {
        const s = v as Registry['stores']
        return `${s.tag}:${s.n}`
    }
    const c = v as Registry['caches']
    return `${c.tag}:${c.deep.d}`
}

console.log(read('stores'), read('caches'))

let calls = 0
function pickKind(): 'stores' | 'caches' {
    calls += 1
    return calls % 2 === 0 ? 'stores' : 'caches'
}
const w = reg[pickKind()]
console.log(calls, (w as Registry['caches']).tag)
