// A property assignment USED AS A VALUE. `a.length = o.head = 0` is one
// statement holding two writes: the outer one is a statement, but the
// inner one has to yield the value the outer consumes. Nothing about the
// write itself differs from statement position -- only the value was
// missing, so the whole chained idiom fenced (SC1090, "assignment to
// non-variables as an expression").
//
// The yielded value is the assigned one and the writes still happen in
// JS's order: the target reference first, then the RHS, then the write.

class Session {
    public head = 0
    public label = 'idle'
    public readonly inbox: string[] = []

    public clear(): void {
        // The zapo idiom, verbatim: an array clear whose length comes from
        // an inner field write.
        this.inbox.length = this.head = 0
    }
}

const s = new Session()
s.inbox.push('a', 'b', 'c')
s.head = 2
console.log(s.inbox.length, s.head)
s.clear()
console.log(s.inbox.length, s.head)

// The expression's VALUE is the assigned value.
const yielded = (s.head = 7)
console.log(yielded, s.head)

// Chains of three: every slot takes the same value, right to left.
class Pair {
    public a = 0
    public b = 0
}
const p = new Pair()
const q = new Pair()
let loose = -1
loose = p.a = q.b = 42
console.log(loose, p.a, q.b)

// A record (object-literal shape) target, not just a class instance.
interface Counters {
    hits: number
    misses: number
    name: string
}
const c: Counters = { hits: 0, misses: 0, name: 'c' }
const both = (c.hits = c.misses = 3)
console.log(both, c.hits, c.misses)

// EVALUATION ORDER: the target reference is evaluated before the RHS.
function recv(tag: string, o: Pair): Pair {
    console.log('recv:' + tag)
    return o
}
function val(tag: string, n: number): number {
    console.log('val:' + tag)
    return n
}
recv('outer', p).a = val('inner', 11)
console.log(p.a)

// Order holds through a chain too -- outer receiver, inner receiver,
// inner RHS, inner write, outer write.
recv('L', p).b = recv('R', q).a = val('n', 5)
console.log(p.b, q.a)

// The value flows into an argument slot and a condition.
function twice(n: number): number {
    return n * 2
}
console.log(twice((c.hits = 8)))
if ((c.misses = 0) === 0) {
    console.log('zeroed', c.misses)
}

// A string field: the yielded value is the string, and the slot holds it.
const label = (s.label = 'running')
console.log(label, s.label, label === s.label)

// Assignment inside a loop condition-ish position: the value drives the
// arithmetic while the field keeps the last write.
let total = 0
for (let i = 1; i <= 3; i++) {
    total += p.a = i * 10
}
console.log(total, p.a)

// A field of a nested record, reached through a chain of reads.
interface Outer {
    inner: { depth: number }
}
const o: Outer = { inner: { depth: 0 } }
console.log((o.inner.depth = 4), o.inner.depth)

// RC pressure: the yielded value is REFCOUNTED and read twice (once by
// the write, once as the expression's value), which is where a chained
// write would leak or double-free. Two refcounted slots take the same
// fresh value 20000 times; a leak shows as growth, a double free as a
// crash, and the last values still have to be right.
class Slot {
    public text = ''
    public list: string[] = []
}
const s1 = new Slot()
const s2 = new Slot()
let lastLen = 0
for (let i = 0; i < 20000; i++) {
    const fresh = 'chunk-' + String(i % 97)
    lastLen += (s1.text = s2.text = fresh).length
    if (i % 5000 === 0) {
        s1.list = s2.list = [fresh, 'x']
    }
}
console.log(lastLen, s1.text, s2.text, s1.text === s2.text)
console.log(s1.list.length, s1.list[0], s1.list === s2.list)
