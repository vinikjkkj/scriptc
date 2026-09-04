// The static->dyn boundary COPIES arrays and records and SHARES everything
// else. This program pins the SHARING half.
//
// The copying half is a known open defect: recovering an array or a record
// out of a value that crossed into an `unknown` slot hands back a SECOND
// object where Node hands back the first — `back === original` false,
// writes invisible in both directions, and a write made through the
// original since the crossing missing from the copy, all of it at exit 0
// with no diagnostic. A refusal on the recovery was tried and REVERTED: the
// bit it can test (`static_copy`) is set on every array and record that
// crosses, not only on the ones whose copy is ever observed, so it turned
// 39 corpus programs that answer Node correctly today into hard errors.
// Closing it for real needs the recovery to hand back the ORIGIN, which is
// a representation change rather than a walker one.
//
// FOUR kinds cross by REFERENCE and recover as themselves, so identity and
// mutation are already Node's for them: a class instance boxes a retained
// pointer, a Uint8Array shares one refcounted ScrBytes, a Map boxes by
// reference, and a closure boxes the closure. TWO more receivers must also
// come back untouched — a dyn that was PARSED (nothing was copied, so there
// is no original to diverge from) and a crossing of a TEMPORARY the caller
// does not name (`f({ a: 1 })`, which `dynCopyIsObservable` excludes on
// purpose: nothing can observe that copy).
//
// Every line here answers correctly today, and the point is that whatever
// eventually closes the copying half leaves them alone: a guard planted at
// the boundary is one wrong `&&` away from refusing the six receivers that
// were never wrong, and that failure mode is silent in the corpus unless
// something asserts against it.

class Box {
    public n = 1
    public tag: string
    constructor(tag: string) {
        this.tag = tag
    }
}

function roundTrip(v: unknown): unknown {
    return v
}

interface Rec {
    id: number
    tags: string[]
}

interface Small {
    id: number
}

// A class instance: SCR_DYN_OBJINST, a retained pointer.
const k = new Box('k')
const k2 = roundTrip(k) as Box
console.log('class identity', k === k2)
k.n = 5
console.log('class write through the original', k2.n)
k2.n = 7
console.log('class write through the recovered value', k.n)
console.log('class tag', k2.tag)

// A Uint8Array: SCR_DYN_BYTES over the SAME refcounted ScrBytes.
const u = new Uint8Array([1, 2, 3])
const u2 = roundTrip(u) as Uint8Array
u[0] = 9
console.log('bytes write through the original', u2[0])
u2[1] = 8
console.log('bytes write through the recovered value', u[1])
console.log('bytes length', u2.length)

// A Map: boxed by reference.
const m = new Map<string, number>([['a', 1]])
const m2 = roundTrip(m) as Map<string, number>
m.set('b', 2)
console.log('map identity', m === m2)
console.log('map size after a write through the original', m2.size)
console.log('map read through the recovered value', m2.get('a'))

// A function: SCR_DYN_FUNC over the retained closure.
let calls = 0
const f = (x: number): number => {
    calls += 1
    return x + 1
}
const f2 = roundTrip(f) as (x: number) => number
console.log('function through the boundary', f2(1))
console.log('the closure that ran was the original', calls)

// A PARSED dyn: no static original exists, so nothing was copied.
const parsed: unknown = JSON.parse('{"id":7,"tags":["a","b"]}')
const rec = parsed as Rec
console.log('parsed record', rec.id, rec.tags.length)
rec.id = 8
console.log('parsed record after a write', rec.id)
const parsedArr = JSON.parse('[1,2,3]') as number[]
parsedArr.push(4)
console.log('parsed array after a push', JSON.stringify(parsedArr))

// A TEMPORARY crossing: the caller names nothing, so the copy is
// unobservable and dynCopyIsObservable declines to mark it.
const tmp = roundTrip({ id: 3 }) as Small
console.log('temporary record', tmp.id)
const tmpArr = roundTrip([1, 2]) as number[]
tmpArr.push(3)
console.log('temporary array', JSON.stringify(tmpArr))
