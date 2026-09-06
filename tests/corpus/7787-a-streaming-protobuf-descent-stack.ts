// The shape `a.length op=` exists for: a DESCENT STACK popped by
// `stack.length -= 1`, which is how zapo-js 1.8.2's streaming protobuf
// reader (`util/proto-stream.ts`) leaves a nested field. The frames are
// records, so a grown slot has a representation (NULL, the absent value
// `new Array(n)` already fills with) and every operator is admitted.
//
// The second half is the arrays whose elements CANNOT hold a hole. A
// number-element array has no absent value that is not a lie on read —
// 0 where Node reads undefined — which is why `a.length = n` fences a
// growable store on one. The compound spelling inherits that wall, and
// inherits one exception: `a.length--` and `a.length -= <positive
// literal>` land strictly BELOW the current length, so they cannot grow
// and they lower. Everything else over a scalar-element array is a
// compile-time refusal, not a silent 0.
//
// What this pins against Node: the pop loop's exact frame accounting, the
// grow arm's holes being overwritable slots (writing into one and reading
// it back is exact — it is only reading an UNWRITTEN one that diverges),
// and the scalar shrink answering the same tail Node keeps.

interface DescentFrame {
    readonly fieldNumber: number
    readonly endOffset: number
}

// ── the pop loop, verbatim in shape ──────────────────────────────────────
const stack: DescentFrame[] = []
const events: string[] = []

function enter(fieldNumber: number, endOffset: number): void {
    stack.push({ fieldNumber, endOffset })
    events.push(`enter:${fieldNumber}@${stack.length}`)
}

function leaveThrough(consumed: number): void {
    while (stack.length > 0 && consumed >= stack[stack.length - 1].endOffset) {
        const frame = stack[stack.length - 1]
        stack.length -= 1
        events.push(`leave:${frame.fieldNumber}@${stack.length}`)
    }
}

enter(1, 40)
enter(3, 24)
enter(7, 12)
leaveThrough(12)
enter(9, 30)
leaveThrough(30)
leaveThrough(40)
console.log(events.join(" "))
console.log("depth", stack.length)

// The same loop again over a stack that never fully unwinds, so the tail
// the truncate DROPPED is observably gone and the one it kept is intact.
enter(2, 100)
enter(4, 60)
enter(6, 50)
leaveThrough(60)
console.log("kept", stack.length, stack[0].fieldNumber, stack[stack.length - 1].fieldNumber)

// ── the same pop, held on `this` ─────────────────────────────────────────
// `this.stack.length -= 1` is a COMPUTED receiver (`this.stack` is a
// property access, not an identifier), which the ordinary field-compound
// path refuses outright because its write re-lowers the receiver. This one
// evaluates the receiver into a temp instead, so the shape lowers and the
// element form below it does too.
class Descent {
    readonly frames: DescentFrame[] = []
    readonly lanes: number[][] = [[10, 11, 12], [20, 21]]
    push(fieldNumber: number, endOffset: number): void {
        this.frames.push({ fieldNumber, endOffset })
    }
    pop(): void {
        this.frames.length -= 1
    }
    trimLane(): void {
        this.lanes[0].length -= 1
    }
    depth(): number {
        return this.frames.length
    }
}

const d = new Descent()
d.push(11, 5)
d.push(13, 9)
d.push(17, 14)
console.log("this-depth", d.depth())
d.pop()
console.log("this-popped", d.depth(), d.frames[d.depth() - 1].fieldNumber)
d.trimLane()
console.log("this-lane", d.lanes[0].join(","), d.lanes[1].join(","))

// The receiver is an arbitrary expression and it is evaluated ONCE.
let picks = 0
function pick(): number[][] { picks++; return d.lanes }
pick()[1].length -= 1
console.log("picked", picks, d.lanes[1].join(","))

// ── the grow arm: holes are slots, and a written slot reads back ─────────
const grown: DescentFrame[] = [{ fieldNumber: 1, endOffset: 10 }]
grown.length += 2
console.log("grown", grown.length)
grown[1] = { fieldNumber: 2, endOffset: 20 }
grown[2] = { fieldNumber: 3, endOffset: 30 }
const seen: string[] = []
for (let i = 0; i < grown.length; i++) seen.push(`${grown[i].fieldNumber}/${grown[i].endOffset}`)
console.log("filled", seen.join(" "))

// ── scalar elements: the proven shrinks lower, and answer Node ───────────
const offsets: number[] = [0, 7, 19, 34, 50]
offsets.length -= 2
console.log("offsets", offsets.length, offsets[0], offsets[offsets.length - 1])
offsets.length--
console.log("offsets2", offsets.length, offsets[offsets.length - 1])

const flags: boolean[] = [true, false, true, true]
flags.length--
console.log("flags", flags.length, flags[flags.length - 1])

const names: string[] = ["alpha", "beta", "gamma"]
names.length -= 1
console.log("names", names.length, names.join(","))

// A scalar shrink that lands exactly on zero, and the array after it.
const zeroed: number[] = [1, 2]
zeroed.length -= 2
console.log("zeroed", zeroed.length, zeroed.join(","))
zeroed.push(9)
console.log("rezeroed", zeroed.length, zeroed[0])

// And one that would go negative: the RangeError arrives before any
// element moves, so the two survivors are still there.
const guarded: number[] = [4, 5]
try {
    guarded.length -= 3
} catch (err) {
    console.log("guarded", (err as Error).name, (err as Error).message)
}
console.log("still", guarded.length, guarded.join(","))
