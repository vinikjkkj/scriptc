// The checked cast of 'unknown' to a NON-adaptable function type — a
// signature whose return carries function fields, so no argument/result
// adapter exists (canAdaptDynFuncTo says no). The cast still compiles,
// with EXACT-UNWRAP-ONLY semantics: a dyn value boxed FROM the target's
// own type unwraps by identity (the interned signature key — same key,
// same ABI, same closure back), and any other function value throws the
// path-annotated TypeError where an adapter would have lied.
//
// The adaptable half keeps its historic adapter path (the second stanza:
// a JSON-safe signature adapts fine after a round trip through unknown).

type Made = { readonly tag: string; readonly describe: () => string }
type Maker = (tag: string) => Made

const mk: Maker = (tag) => ({ tag, describe: () => `made:${tag}` })

// Round trip through 'unknown': the box preserves identity, the cast
// unwraps the very closure that went in.
const u: unknown = mk
const back = u as Maker
console.log(back('x').describe())
console.log(back('y').tag)
console.log(back === mk)

// The ADAPTABLE boundary is untouched: JSON-safe signatures still adapt.
const add = (a: number, b: number): number => a + b
const v: unknown = add
const addBack = v as (a: number, b: number) => number
console.log(addBack(20, 22))
