// A bound function is a NEW function object, and it is one per BIND.
//
// `Function.prototype.bind` on the TypeScript side of this compiler was
// an ERASURE: `f.bind(x)` compiled to `f` itself, on the sound-as-far-as-
// it-went reason that a TypeScript function value cannot observe a bound
// receiver (`this` in a plain TS function is tsc's own error). What the
// erasure also dropped is that bind CONSTRUCTS. `g.bind(null) === g` is
// `false` in every engine and this compiler said `true` — silently, and
// invisibly to the trap census, because an erasure emits no trap.
//
// Corpus 2690 is where the erasure was written down. This program is the
// other half of that decision: everything the erasure got right (the
// receiver is still dropped, the call still lands, the argument still
// evaluates) plus the one thing it got wrong.

function g(n: number): boolean {
    return n === 42
}

function two(n: number, m: number): number {
    return n + m
}

const arrow = (n: number): boolean => n === 42

const b1 = g.bind(null)
const b2 = g.bind(null)

console.log(b1 === g, b2 === g, b1 === b2, b1 === b1)
console.log(arrow.bind(null) === arrow)
console.log(b1.bind(null) === b1)
console.log(b1(42), b1(1), b2(42))

// One object per bind, not one per SITE: the forwarding wrapper is
// interned per signature, so a single lift backs every bind of this
// shape. If the CLOSURE were interned with it, these would all be one
// object.
const made: ((n: number) => boolean)[] = []
for (let i = 0; i < 3; i++) made.push(g.bind(null))
console.log(made[0] === made[1], made[1] === made[2], made[0] === g)
console.log(made[0]!(42), made[2]!(1))

// Partial application, which the erasure could not express at all — an
// extra leading argument was SC1090.
console.log(two.bind(null, 1)(2), two.bind(null, 1, 2)())

// The receiver argument still runs, in JS's own order: after the callee,
// before the bound arguments.
const order: string[] = []
function note(s: string): null {
    order.push(s)
    return null
}
const ordered = two.bind(note('this'), (order.push('arg0'), 10))
console.log(order.join(','), ordered(5))

// A bound function is a value like any other: it flows into a record, an
// array and a parameter, and stays itself down every one of them.
const rec = { f: b1, g: g }
console.log(rec.f === g, rec.f === b1, rec.g === g)
console.log([b1][0] === b1, [b1][0] === g)

function takes(f: (n: number) => boolean): boolean {
    return f === g
}
console.log(takes(b1), takes(g))

// A class method's bind was already right — it goes through a different
// path, and this program is what keeps the two paths from being confused
// for one another.
class K {
    v: number
    constructor(v: number) {
        this.v = v
    }
    m(): number {
        return this.v
    }
}
const k = new K(7)
const m1 = k.m.bind(k)
const m2 = k.m.bind(k)
console.log(m1(), m2(), m1 === m2)
