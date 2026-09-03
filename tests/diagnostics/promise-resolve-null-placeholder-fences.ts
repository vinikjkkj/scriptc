// What the null-payload PLACEHOLDER rule does NOT admit. The rule itself is
// exercised by tests/corpus/7420: `Promise.resolve(null as never)` filling a
// record field makes that field's payload void, so the promise settles and
// nothing can read a value node only has as `null`.
//
// Every site below keeps a refusal, and each keeps a DIFFERENT one:
//
//  1. The destination is a variable, not a record field. There is no slot
//     whose layout the whole program shares, so nothing can carry the mark —
//     SC2020, the original fence, unchanged.
//  2. The argument has EFFECTS. That is the fence's own stated reason ("the
//     argument's effects must still run — no statement slot exists here for
//     them"), and it stands: only a bare `null` is admitted, because only a
//     bare `null` has nothing to drop.
//  3. The argument is `undefined as never`. Node fulfils that promise with
//     `undefined`, not `null`; the rule is written for the value it can name
//     and declines the other one rather than guessing they are the same.
//  4. READING the marked field's fulfillment value. Node's answer is `null`
//     and the declared payload is a record, so there is nothing to answer
//     with — the void payload makes the read a compile-time refusal instead
//     of a runtime throw or a plausible empty record.
//  5. The marked field flowing into a `Promise<Conn>` slot. Same reason one
//     step out: the slot promises a payload this promise does not carry.

interface Conn {
    readonly driver: string
}

interface Entry {
    connectionPromise: Promise<Conn>
    refs: number
}

let effects = 0

function bump(): never {
    effects += 1
    throw new Error('bump')
}

function take(p: Promise<Conn>): void {
    void p
}

async function main(): Promise<void> {
    // 1 — a variable destination.
    const loose: Promise<Conn> = Promise.resolve(null as never)
    await loose

    // 2 — an argument with effects.
    const effectful: Entry = { connectionPromise: Promise.resolve(bump()), refs: 0 }
    await effectful.connectionPromise

    // 3 — `undefined as never`, which fulfils with a different value.
    const undef: Entry = { connectionPromise: Promise.resolve(undefined as never), refs: 0 }
    await undef.connectionPromise

    // 4/5 — the marked field read for its value, and passed on as one.
    const marked: Entry = { connectionPromise: Promise.resolve(null as never), refs: 0 }
    const conn = await marked.connectionPromise
    console.log(conn.driver)
    take(marked.connectionPromise)
    console.log(effects)
}

main()
