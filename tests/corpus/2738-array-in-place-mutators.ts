// The three IN-PLACE Array.prototype mutators that had no lowering:
// `unshift`, `reverse` and `copyWithin`. The copying siblings were already
// there (`toReversed`, `toSpliced`, `with`), and so were the in-place
// writers at the END (`push`/`pop`) and at the FRONT for reads
// (`shift`/`splice`) — these three completed the surface.
//
// What this pins against Node:
//
//  - unshift lands its arguments at the head IN DECLARATION ORDER, not
//    reversed. The lowering evaluates left to right (JS argument order,
//    observed here through a side-effecting argument) and then inserts
//    right to left, and only the pair together gives Node's answer.
//  - unshift's result is the NEW LENGTH, and the zero-argument call is
//    Node's no-op that still answers the unchanged length.
//  - reverse answers the RECEIVER, not a copy: `a.reverse() === a` in JS,
//    so a push through the returned handle must be visible through the
//    original binding.
//  - copyWithin never changes the length. Every index runs
//    ToIntegerOrInfinity with negative-from-the-end resolution and
//    clamping, and the count is min(end - start, len - target) — a target
//    past the end, a start after the end, and a negative end each have a
//    Node answer that a naive memmove would get wrong.
//  - the REFERENCE-element forms, where the refcount work lives: copyWithin
//    over an array of records OVERLAPS its source and destination in the
//    ring-buffer compaction shape, so a copy that released the overwritten
//    slots before retaining the source ones would free a value the copy
//    still has to read. Every such array is printed AFTER the mutation.
//  - unshift of a UNION-element value wraps its arm exactly like a push.

type Entry = { readonly subtype?: string | undefined; readonly handler: string }

function show(list: readonly Entry[]): string {
    const parts: string[] = []
    for (let i = 0; i < list.length; i += 1) {
        parts.push(`${list[i].subtype ?? '-'}:${list[i].handler}`)
    }
    return parts.join(',')
}

function unshiftCases(): void {
    // The wall's own shape: prepending a record onto a registry of records.
    const handlers: Entry[] = []
    handlers.push({ subtype: 'a', handler: 'H1' })
    handlers.push({ subtype: undefined, handler: 'H2' })
    console.log(`u1 ${handlers.unshift({ subtype: 'z', handler: 'H0' })} ${show(handlers)}`)

    const nums: number[] = [3, 4]
    console.log(`u2 ${nums.unshift(1, 2)} ${nums.join(',')}`)
    console.log(`u3 ${nums.unshift()} ${nums.join(',')}`)

    const strs: string[] = []
    console.log(`u4 ${strs.unshift('x')} ${strs.join(',')}`)
    console.log(`u5 ${strs.unshift('p', 'q', 'r')} ${strs.join(',')}`)

    const bools: boolean[] = [true]
    console.log(`u6 ${bools.unshift(false, true)} ${bools.join(',')}`)

    // Argument order: JS evaluates left to right BEFORE inserting, and the
    // inserted run reads in declaration order.
    const order: string[] = []
    const tick = (s: string): number => {
        order.push(s)
        return s.length
    }
    const ev: number[] = [9]
    ev.unshift(tick('aa'), tick('b'), tick('ccc'))
    console.log(`u7 ${order.join('|')} ${ev.join(',')}`)

    // An argument that READS the receiver sees the pre-unshift state.
    const self: number[] = [5, 6]
    self.unshift(self.length)
    console.log(`u8 ${self.join(',')}`)

    // Union elements wrap their arm on the way in, exactly like push.
    const maybe: (string | null)[] = ['keep']
    maybe.unshift(null, 'head')
    const parts: string[] = []
    for (let i = 0; i < maybe.length; i += 1) parts.push(maybe[i] ?? 'NULL')
    console.log(`u9 ${parts.join(',')}`)

    // Arrays of arrays: the element is itself refcounted.
    const nested: number[][] = [[3]]
    nested.unshift([1, 2])
    console.log(`u10 ${nested.length} ${nested[0].join('')} ${nested[1].join('')}`)
}

function reverseCases(): void {
    const rev = [1, 2, 3, 4]
    const same = rev.reverse()
    same.push(0)
    console.log(`r1 ${rev.join(',')} ${same.join(',')} ${rev.length}`)

    const recs: Entry[] = [
        { subtype: 'p', handler: 'A' },
        { subtype: 'q', handler: 'B' },
        { subtype: 'r', handler: 'C' }
    ]
    console.log(`r2 ${show(recs.reverse())}`)

    const empty: string[] = []
    console.log(`r3 [${empty.reverse().join(',')}]`)
    console.log(`r4 ${[7].reverse().join(',')}`)
    console.log(`r5 ${['a', 'b'].reverse().join(',')}`)
    console.log(`r6 ${[1, 2, 3, 4, 5].reverse().join(',')}`)

    // The zapo shape: build a list, then reverse it in place on the way out.
    const seen: string[] = []
    const acc: string[] = []
    for (const k of ['m1', 'm2', 'm3', 'm2', 'm4']) {
        if (seen.indexOf(k) >= 0) continue
        seen.push(k)
        acc.push(k)
    }
    console.log(`r7 ${acc.reverse().join(',')}`)
}

function copyWithinCases(): void {
    // The ring-buffer compaction: slide the live tail to the front, then
    // truncate. copyWithin must leave the length alone for this to work.
    const q: string[] = ['a', 'b', 'c', 'd', 'e', 'f']
    q.copyWithin(0, 2)
    console.log(`c1a ${q.join(',')} len=${q.length}`)
    q.length = 4
    console.log(`c1b ${q.join(',')}`)

    const c2 = [0, 1, 2, 3, 4, 5, 6, 7]
    console.log(`c2 ${c2.copyWithin(2, 0, 4).join(',')}`)
    const c3 = [0, 1, 2, 3, 4, 5, 6, 7]
    console.log(`c3 ${c3.copyWithin(0, 3, 6).join(',')}`)

    // Index edge cases, each with a Node answer a naive memmove misses.
    console.log(`c4 ${[0, 1, 2, 3, 4].copyWithin(-2, 0).join(',')}`)
    console.log(`c5 ${[0, 1, 2, 3, 4].copyWithin(0, -2).join(',')}`)
    console.log(`c6 ${[0, 1, 2, 3, 4].copyWithin(0, 1, -1).join(',')}`)
    console.log(`c7 ${[0, 1, 2, 3, 4].copyWithin(10, 0).join(',')}`)
    console.log(`c8 ${[0, 1, 2, 3, 4].copyWithin(0, 4, 2).join(',')}`)
    console.log(`c9 ${[0, 1, 2, 3, 4].copyWithin(0, 10).join(',')}`)
    console.log(`c10 ${[0, 1, 2, 3, 4].copyWithin(-10, 1).join(',')}`)
    console.log(`c11 ${[0, 1, 2, 3, 4].copyWithin(3, 0, 10).join(',')}`)
    console.log(`c12 ${[0, 1, 2, 3, 4].copyWithin(2, 2).join(',')}`)
    console.log(`c13 ${[0, 1, 2, 3, 4].copyWithin(1.7, 0.9).join(',')}`)
    const c14: number[] = []
    console.log(`c14 [${c14.copyWithin(0, 0).join(',')}]`)

    // Reference elements. The forward overlap (destination BELOW the
    // source) is the compaction shape; the backward one (destination
    // ABOVE) reads slots the write would otherwise have clobbered.
    const refs: Entry[] = [
        { subtype: '1', handler: 'A' },
        { subtype: '2', handler: 'B' },
        { subtype: '3', handler: 'C' },
        { subtype: '4', handler: 'D' }
    ]
    refs.copyWithin(0, 2)
    console.log(`c15 ${show(refs)}`)

    const strRefs = ['aa', 'bb', 'cc', 'dd']
    strRefs.copyWithin(1, 0, 2)
    console.log(`c16 ${strRefs.join(',')}`)

    const nested: number[][] = [[1], [2], [3], [4]]
    nested.copyWithin(2, 0)
    const flat: string[] = []
    for (let i = 0; i < nested.length; i += 1) flat.push(nested[i].join(''))
    console.log(`c17 ${flat.join(',')}`)

    // A self-copy over the whole range keeps every element alive.
    const whole: string[] = ['w', 'x', 'y']
    whole.copyWithin(0, 0)
    console.log(`c18 ${whole.join(',')} ${whole.length}`)

    // Chaining off the returned receiver, and the identity that makes it
    // legal.
    const chain = [1, 2, 3, 4]
    const back = chain.copyWithin(0, 1)
    back.push(9)
    console.log(`c19 ${chain.join(',')} ${back.join(',')}`)
}

// The refcount stress: enough churn that a leak or a premature free shows
// as a crash or a wrong sum rather than as nothing at all. Every iteration
// unshifts records onto a live array, reverses it, compacts it with
// copyWithin, and reads through the survivors.
function stress(): void {
    let total = 0
    for (let round = 0; round < 4000; round += 1) {
        const list: Entry[] = []
        for (let i = 0; i < 8; i += 1) {
            list.unshift({ subtype: i % 3 === 0 ? undefined : `s${i}`, handler: `h${round % 7}${i}` })
        }
        list.reverse()
        list.copyWithin(0, 3)
        list.length = 5
        for (let i = 0; i < list.length; i += 1) {
            total += list[i].handler.length + (list[i].subtype === undefined ? 1 : 2)
        }
        const nums: number[] = [round]
        nums.unshift(round + 1, round + 2)
        nums.reverse()
        nums.copyWithin(0, 1)
        total += nums[0] - round
    }
    console.log(`stress ${total}`)
}

unshiftCases()
reverseCases()
copyWithinCases()
stress()
