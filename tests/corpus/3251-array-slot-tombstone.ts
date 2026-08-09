// The TOMBSTONE write `a[i] = null as unknown as T` — the GC-drop idiom a
// ring-buffer queue uses to stop retaining an item it has already handed
// out. There is no unit VALUE of type T, so the coercion used to become
// Lowerer.strandedUnitTrap's catchable throw AT THE WRITE; the SLOT has an
// absent value and always has (Array.from({length: n}) fills n of them,
// `a.length = n` grows more), so the write stores that and the READ is what
// refuses it.
//
// Everything below is what Node and scriptc AGREE on: the write itself, the
// length arithmetic around it, the copies that propagate a hole, and the
// release accounting. Reading a tombstoned slot is the documented dense-
// array divergence (Node reads undefined; scriptc traps with the index and
// the length) and is pinned by the accounting test, not here.

interface QueueItem {
    readonly task: () => number
    readonly resolve: (v: number) => void
    readonly reject: (e: string) => void
}

// ── BoundedTaskQueue.drain, the shape this exists for ────────────────────
const queue: QueueItem[] = []
let head = 0
let sum = 0
for (let n = 1; n <= 4; n++) {
    queue.push({
        task: () => n * 10,
        resolve: (v: number) => { sum = sum + v },
        reject: (e: string) => { console.log("reject", e) },
    })
}
console.log("enqueued", queue.length, "pending", queue.length - head)
while (head < queue.length) {
    const item = queue[head]
    queue[head] = null as unknown as QueueItem
    head++
    item.resolve(item.task())
    console.log("drained", head, "pending", queue.length - head)
}
console.log("sum", sum, "len", queue.length, "head", head)

// The compaction half: copyWithin over a run whose head slots are all
// tombstones, then the truncate. Both survive a hole.
const ring: QueueItem[] = []
for (let n = 0; n < 5; n++) {
    ring.push({ task: () => n, resolve: () => {}, reject: () => {} })
}
ring[0] = null as unknown as QueueItem
ring[1] = null as unknown as QueueItem
ring.copyWithin(0, 2)
ring.length = 3
console.log("compacted", ring.length, ring[0].task(), ring[1].task(), ring[2].task())

// ── the tombstone is a release, and the slot is reusable ─────────────────
let freed = 0
const cells: QueueItem[] = [
    { task: () => 1, resolve: () => { freed = freed + 1 }, reject: () => {} },
    { task: () => 2, resolve: () => { freed = freed + 1 }, reject: () => {} },
]
cells[0] = null as unknown as QueueItem
cells[0] = { task: () => 99, resolve: () => {}, reject: () => {} }
console.log("reused", cells[0].task(), cells[1].task(), "freed", freed)

// Clearing the SAME slot twice releases once and stays absent.
const twice: string[] = ["a", "b"]
twice[1] = null as unknown as string
twice[1] = null as unknown as string
twice[1] = "b2"
console.log("twice", twice.length, twice[0], twice[1])

// ── every refcounted element kind takes a tombstone ──────────────────────
const strs: string[] = ["s0", "s1"]
strs[0] = null as unknown as string
strs[0] = "s0b"
console.log("strs", strs.join(","))

const nested: number[][] = [[1, 2], [3]]
nested[0] = null as unknown as number[]
nested[0] = [4, 5, 6]
console.log("nested", nested[0].length, nested[1].length)

class Node2 {
    public readonly id: number
    public constructor(id: number) { this.id = id }
}
const objs: Node2[] = [new Node2(1), new Node2(2)]
objs[1] = null as unknown as Node2
objs[1] = new Node2(3)
console.log("objs", objs[0].id, objs[1].id)

// `undefined` is the same source through the same assertions.
const undef: string[] = ["u0", "u1"]
undef[0] = undefined as unknown as string
undef[0] = "u0b"
console.log("undef", undef.join("/"))

// ── copies PROPAGATE a hole; only a read refuses one ─────────────────────
const holed: string[] = ["h0", "h1", "h2"]
holed[1] = null as unknown as string
console.log("holed len", holed.length, "head", holed[0], "tail", holed[2])
const spread = [...holed]
const sliced = holed.slice(0, 3)
console.log("copies", spread.length, sliced.length, spread[2], sliced[0])
const pushed: string[] = ["p"]
pushed.push(...holed)
console.log("pushed", pushed.length, pushed[0], pushed[1])

// A needle still finds the live entries around a hole, and never the hole.
const needle = new Node2(7)
const hunt: Node2[] = [new Node2(6), needle, new Node2(8)]
hunt[0] = null as unknown as Node2
console.log("indexOf", hunt.indexOf(needle), hunt.includes(needle), hunt.indexOf(new Node2(6)))

// Truncating past a hole releases it with everything else.
const drop: string[] = ["d0", "d1", "d2", "d3"]
drop[2] = null as unknown as string
drop.length = 2
console.log("dropped", drop.length, drop.join("+"))

// fill() writes over holes — the reason its ref form guards NULL.
const refill: string[] = ["r0", "r1", "r2"]
refill[1] = null as unknown as string
refill.fill("x")
console.log("refilled", refill.join(""))

// A tombstone in a LOCAL array that goes out of scope: the teardown release
// walks a hole without touching it.
function scoped(): number {
    const local: Node2[] = [new Node2(10), new Node2(11)]
    local[0] = null as unknown as Node2
    return local[1].id
}
console.log("scoped", scoped(), scoped())
