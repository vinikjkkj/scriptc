// The static->dyn boundary COPIES arrays and records, and the RECOVERY on
// the way back out now hands the ORIGIN back instead of a second object.
//
// 7460 pins the half that already worked: a class instance, a Uint8Array, a
// Map and a closure cross by REFERENCE, so identity and mutation were
// always Node's for them. This program pins the half that did not. Every
// line below answered WRONG at exit 0 with no diagnostic before the origin
// was recorded: identity read false, a push through the recovered value
// left the original alone, a write through the original was invisible in
// the recovered value, and a write made BETWEEN the crossing and the cast
// was missing from the recovered value entirely.
//
// WHY THE ORIGIN AND NOT SHARED STORAGE. A typed array crosses by reference
// because ScrBytes is ONE refcounted object with two views. An array and a
// record have no such object: a packed ScrArr of monomorphic 8-byte slots
// and a C struct of mangled fields on one side, a ScrDyn** vector and a
// ScrDynEntry table on the other. Making those share would change what an
// ARR/OBJ dyn node physically IS, which is 86 distinct runtime functions
// that read `v.arr.*` or `v.obj.*` plus every compiler-emitted walker on
// both backends. Remembering the origin changes neither representation:
// the copy is built exactly as it was, and only the way BACK is different.
//
// WHY NOT A REFUSAL. One was tried at these same two exits and reverted: it
// turned 39 corpus programs that answer Node correctly into hard errors,
// because the bit it could test is set on every array and record that
// crosses and not only on the ones whose copy is ever observed. A receiver
// at a cast cannot tell a copy whose loss matters from one whose loss does
// not — 5851 is the proof, where the record copies, its payload is shared,
// and Node and scriptc already agree. The origin needs no such judgement:
// a hit hands back a better VALUE and a miss builds exactly what it always
// built, so this line refuses nothing and can redden nothing.
//
// STILL OPEN, deliberately not asserted here because it is still wrong: a
// read THROUGH the dyn value itself is served from the copy's own storage,
// so `JSON.stringify(d)` and `String(d)` after a write through the original
// answer the value as of the crossing. Closing that needs every dyn
// OBSERVATION surface to re-derive from the origin (or a change stamp on
// ScrArr and on every record struct to tell it when to) — a different and
// much wider change than this one, and one that must not be made surface by
// surface: a value whose stringify is fresh and whose Object.keys is stale
// is the "one value, two renderings" shape this tree refuses.

interface Rec {
    id: number
    tags: string[]
}

function roundTrip(v: unknown): unknown {
    return v
}

// ── an ARRAY: identity, and a write in each direction ──────────────────
const a = [1, 2, 3]
const b = roundTrip(a) as number[]
console.log('array identity', a === b)
b.push(4)
console.log('the original after a push through the recovered value', JSON.stringify(a))
a[0] = 9
console.log('the recovered value after a write through the original', b[0])
console.log('one object, so one length', a.length, b.length)

// ── a RECORD: identity, and a write in each direction ──────────────────
const r: Rec = { id: 1, tags: ['x'] }
const r2 = roundTrip(r) as Rec
console.log('record identity', r === r2)
r2.id = 5
console.log('the original after a write through the recovered value', r.id)
r.id = 6
console.log('the recovered value after a write through the original', r2.id)

// A field of the recovered record is the ORIGINAL's field, not a copy of
// it: the origin is handed back whole, so nothing under it was rebuilt.
r.tags.push('y')
console.log('a nested array reached through the recovered value', JSON.stringify(r2.tags))
console.log('nested identity', r.tags === r2.tags)

// ── a TUPLE, which crosses as the JSON array it is everywhere else ─────
const t: [number, string] = [1, 'a']
const t2 = roundTrip(t) as [number, string]
console.log('tuple identity', t === t2)
t2[0] = 42
console.log('the original tuple after a write through the recovered value', t[0])

// ── STALENESS: a write made between the crossing and the cast ──────────
// The dyn value is made at the assignment; the recovery happens two lines
// later, after the original has grown. The recovered value is the original,
// so it has the write.
const s = [10, 20]
const d: unknown = s
s.push(30)
console.log('a write between the crossing and the cast', JSON.stringify(d as number[]))

// A LATE KEY, the record spelling of the same question.
const lr: Record<string, number> = { a: 1 }
const ld: unknown = lr
lr['b'] = 2
console.log('a key added between the crossing and the cast', (ld as Record<string, number>)['b'])

// ── the SAME dyn recovered TWICE is the same object both times ─────────
const twice = roundTrip(a)
console.log('two recoveries of one crossing', (twice as number[]) === (twice as number[]))

// ── a DIFFERENT static type still recovers a fresh object ──────────────
// The origin is remembered under the interned key of the type it crossed
// AT, so recovering at a NARROWER type is a different key: it misses and
// builds the copy it always built. Handing the origin back there would be
// a pointer of the wrong shape — a `{id}` reader over a `{id, tags}`
// struct — so the miss is required, not a shortcut.
//
// It is also the one shape of this defect the origin does NOT close, and
// the assertion here is deliberately only the READ: Node hands the same
// object back whatever type the cast names, so a write through `narrow`
// would reach `wide` under Node and would not here. Asserting that would
// be asserting the bug. Closing it needs the recovery to know that a
// `{id}` view of a `{id, tags}` struct is representable at all, which is a
// question about record subtyping and not about the boundary.
interface Narrow {
    id: number
}
const wide: Rec = { id: 77, tags: ['q'] }
const narrow = roundTrip(wide) as Narrow
console.log('a narrower recovery reads the right value', narrow.id)

// ── a PARSED value has no origin at all, and is unchanged ──────────────
const parsed = JSON.parse('[1,2,3]') as number[]
parsed.push(4)
console.log('a parsed array is untouched by any of this', JSON.stringify(parsed))

// ── a TEMPORARY the caller does not name ───────────────────────────────
// dynCopyIsObservable declines to mark these, so no origin is recorded and
// the recovery builds. Nothing can observe the difference, which is the
// whole reason it is excluded.
function firstId(v: unknown): number {
    return (v as Rec).id
}
console.log('a temporary crossing', firstId({ id: 3, tags: [] }))
