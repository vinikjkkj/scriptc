// `.name` and `.length` on an ordinary function — the two own properties
// every JS function object carries, refused for EVERY function in this
// language until they were folded from the value's CREATION SITE.
//
// The whole risk of closing that refusal is that the fold answers the
// REFERENCE site instead. JS names a function once, when it is made, and
// every later binding carries that one name: `const h = g; h.name` is
// `"g"`. Four separate ways to get it wrong have a line here — the
// reference-site spelling, NamedEvaluation skipped, the `"bound "` prefix
// missing or not stacking, and `length` read off the mapped TYPE rather
// than the erased parameter list.
//
// The `length` cases are the ones a type-driven implementation fails: a
// TypeScript `?` is NOT a default, so `(n, m?)` is 2, while `(n, m = 2)`
// is 1 and a rest parameter stops the count.

function g(n: number): boolean {
    return n === 42
}

function two(n: number, m: number): number {
    return n + m
}

function opt(n: number, m?: number): number {
    return n + (m ?? 0)
}

function dflt(n: number, m: number = 2): number {
    return n + m
}

function rest(n: number, ...r: number[]): number {
    return n + r.length
}

function none(): number {
    return 0
}

const arrow = (n: number): boolean => n === 42
const namedExpr = function inner(n: number): boolean {
    return n === 42
}
const anonExpr = function (n: number): boolean {
    return n === 42
}
const alias = g
const aliasOfAlias = alias

class K {
    m(n: number, o: number): boolean {
        return n === o
    }
}
const k = new K()

const rec = { cb: (n: number) => n === 42, flowed: g }

// The creation site, never the reference site.
console.log(g.name, alias.name, aliasOfAlias.name)
console.log(arrow.name, namedExpr.name, anonExpr.name)
console.log(k.m.name, rec.cb.name, rec.flowed.name)

// `"bound "`, with the space, stacking on a rebind, and over an
// anonymous target too.
const b = g.bind(null)
console.log(b.name, b.bind(null).name, arrow.bind(null).name)

// The ERASED parameter list.
console.log(none.length, g.length, two.length)
console.log(opt.length, dflt.length, rest.length)
console.log(arrow.length, alias.length, k.m.length, rec.cb.length)

// Bound length is the target's less the bound arguments, floored at zero.
console.log(b.length, two.bind(null, 1).length, two.bind(null, 1, 2).length)

// A `let` never written again is as provable as a `const`.
let onceOnly = g
console.log(onceOnly.name, onceOnly.length)

// The properties are ordinary values: they concatenate, compare and go
// into records like any other string and number.
console.log(`${g.name}/${g.length}`)
console.log(g.name === 'g', g.length === 1, g.name.length)
const table = { n: arrow.name, l: arrow.length }
console.log(table.n, table.l)
