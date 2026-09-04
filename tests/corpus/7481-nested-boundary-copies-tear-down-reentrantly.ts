// The reentrancy the boundary copy's ORIGIN table has to survive.
//
// A copy remembers the static object it was made from and holds a counted
// reference to it (7480 is what that buys). Dropping that reference runs an
// arbitrary amount of teardown: a record's `unknown` field, or an array of
// records, can hold ANOTHER boundary copy, whose own teardown re-enters the
// table's deletion from inside it.
//
// So the table empties a slot and finishes its back-shift BEFORE releasing
// anything, and the insert takes its reference before touching the table and
// releases the entry it displaced after. Written the obvious way instead --
// release first, then clear the slot -- a re-entrant call walks a probe path
// with a hole in it, and a re-entrant INSERT can grow the table and free the
// very array the outer call is about to write through. Neither shows up as a
// wrong answer; both are heap corruption, which is why this is a program and
// not a comment.
//
// Both loops also assert IDENTITY at every level on every iteration, by
// making a miss enormous rather than by printing a boolean per turn: a
// single lost identity moves the total by 100000, so the exact sums below
// are the assertion.

interface Outer {
    tag: string
    inner: unknown
}

function cross(v: unknown): unknown {
    return v
}

// An origin whose own field holds a second origin: dropping the outer
// record's reference drops the inner array's from inside the deletion.
let acc = 0
for (let i = 0; i < 4000; i++) {
    const arr = [i, i + 1, i + 2]
    const o: Outer = { tag: 't' + (i % 7), inner: cross(arr) }
    const back = cross(o) as Outer
    const innerBack = back.inner as number[]
    acc += innerBack[0] + innerBack[2]
    if (back !== o) acc += 100000
    if (innerBack !== arr) acc += 1000000
}
console.log('nested origins', acc)

// The nesting the other way: an array whose elements each crossed, so
// releasing the array's origin walks a row of them.
interface Row {
    n: number
}
let acc2 = 0
for (let i = 0; i < 2000; i++) {
    const rows: Row[] = [{ n: i }, { n: i + 1 }]
    const d = cross(rows) as Row[]
    acc2 += d[0].n + d[1].n
    if (d !== rows) acc2 += 100000
}
console.log('a row of origins', acc2)

// Rebinding the SAME static object across many crossings: each crossing
// makes a fresh copy with its own row, and the rows retire in an order
// nothing here controls.
const shared = [1, 2, 3]
let acc3 = 0
for (let i = 0; i < 3000; i++) {
    const a = cross(shared) as number[]
    const b = cross(shared) as number[]
    acc3 += a.length + b.length
    if (a !== b) acc3 += 100000
    if (a !== shared) acc3 += 1000000
}
console.log('one object, many crossings', acc3)
