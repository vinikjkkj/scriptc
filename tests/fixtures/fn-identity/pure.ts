// What a FUNCTION IS, as a value — identity, `.name`, `.length`, and the
// routes each of those can be silently lost down.
//
// Three defects live behind this fixture and each of them was, on main,
// either a silent wrong answer or a refusal of ordinary JavaScript:
//
//   `g.bind(null) === g` answered `true`. A bound function is a NEW
//   function object in every engine; two separate binds of one function
//   are two objects; a bound function put in a record is not the
//   original. The compiler's `.bind` on the TypeScript side was an
//   ERASURE — it compiled to the target itself — so all three compared
//   equal and nothing said so.
//
//   `g.name` and `g.length` were SC2020 for EVERY function in the
//   language. `name` is the creation site's, not the reference site's, so
//   `const h = g; h.name` is `"g"`; an anonymous arrow bound to a `const`
//   takes the binding's name; a bound function is `"bound "` plus its
//   target's, stacking on a rebind. `length` counts the ERASED parameter
//   list — a TypeScript `?` is not a default, so `(n, m?)` is 2 while
//   `(n, m = 2)` is 1, and a rest parameter stops the count.
//
//   A program that DEFINES a global's name got the LIBRARY's function.
//   The last block below is that one, and it is here rather than in a
//   diagnostics test because the failure mode is a running program
//   printing the wrong number.
//
// Every line is `KEY value` so a mismatch names its case instead of
// dumping the stream.

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

const arrow = (n: number): boolean => n === 42
const namedExpr = function inner(n: number): boolean {
    return n === 42
}
const anonExpr = function (n: number): boolean {
    return n === 42
}
const alias = g

class K {
    m(n: number): boolean {
        return n === 42
    }
}

const rec = { f: (n: number) => n === 42, h: g }
const k = new K()

function takesFn(f: (n: number) => boolean): boolean {
    return f === g
}

function givesFn(): (n: number) => boolean {
    return g
}

function makeCapture(): () => boolean {
    const inner = g
    return () => inner === g
}

// ── identity, the routes a fresh allocation would break ────────────────
console.log('id-self', g === g)
console.log('id-alias', alias === g)
console.log('id-arrow-self', arrow === arrow)
console.log('id-record', rec.h === g)
console.log('id-array', [g][0] === g)
console.log('id-param', takesFn(g))
console.log('id-param-neg', takesFn(arrow))
console.log('id-return', givesFn() === g)
console.log('id-return-return', givesFn() === givesFn())
console.log('id-capture', makeCapture()())

// ── identity through bind: a bound function is a NEW object ────────────
const b1 = g.bind(null)
const b2 = g.bind(null)
console.log('bind-vs-target', b1 === g)
console.log('bind-vs-bind', b1 === b2)
console.log('bind-self', b1 === b1)
console.log('bind-arrow', arrow.bind(null) === arrow)
console.log('bind-in-record', { f: g.bind(null) }.f === g)
console.log('rebind', b1.bind(null) === b1)

// ── a bound function still CALLS, and partial application applies ──────
console.log('bind-call-true', b1(42))
console.log('bind-call-false', b1(1))
console.log('bind-partial', two.bind(null, 1)(2))
console.log('bind-partial-2', two.bind(null, 1, 2)())
console.log('bind-partial-len', two.bind(null, 1).length)
console.log('bind-partial-len2', two.bind(null, 1, 2).length)

// ── the receiver argument still EVALUATES, in JS's own order ───────────
const order: string[] = []
function note(s: string): null {
    order.push(s)
    return null
}
const boundOrdered = two.bind(note('this'), (order.push('arg0'), 1))
console.log('bind-order', order.join(','))
console.log('bind-order-call', boundOrdered(2))

// ── .name: the CREATION site's, never the reference site's ─────────────
console.log('name-decl', g.name)
console.log('name-alias', alias.name)
console.log('name-arrow', arrow.name)
console.log('name-named-expr', namedExpr.name)
console.log('name-anon-expr', anonExpr.name)
console.log('name-method', k.m.name)
console.log('name-record-anon', rec.f.name)
console.log('name-record-flowed', rec.h.name)
console.log('name-bound', b1.name)
console.log('name-rebound', b1.bind(null).name)
console.log('name-bound-arrow', arrow.bind(null).name)

// ── .length: the ERASED parameter list ─────────────────────────────────
console.log('len-decl', g.length)
console.log('len-two', two.length)
console.log('len-opt', opt.length)
console.log('len-dflt', dflt.length)
console.log('len-rest', rest.length)
console.log('len-arrow', arrow.length)
console.log('len-alias', alias.length)
console.log('len-method', k.m.length)
console.log('len-bound', b1.length)
console.log('len-record-anon', rec.f.length)

// ── typeof, which never moved and is the control ───────────────────────
console.log('typeof-decl', typeof g)
console.log('typeof-bound', typeof b1)

// ── a program that DEFINES a global's name defines it ──────────────────
// At the top level of a SCRIPT these MERGE with the ambient declarations
// rather than shadowing them, which is exactly why the compiler used to
// call the library's.
function isNaN(n: number): boolean {
    return n === 42
}
function isFinite(n: number): boolean {
    return n === 7
}
function parseFloat(s: string): number {
    return 7
}
function decodeURI(s: string): string {
    return s + '!'
}
function structuredClone(s: string): string {
    return s + '!'
}
console.log('shadow-isNaN', isNaN(42), isNaN(1))
console.log('shadow-isFinite', isFinite(7), isFinite(1))
console.log('shadow-parseFloat', parseFloat('9.5'))
console.log('shadow-decodeURI', decodeURI('a%20b'))
console.log('shadow-structuredClone', structuredClone('a'))

console.log('END done')
