// `Promise.resolve(u)` where u is a settle-or-value union — `T | Promise<T>`.
//
// The refusal read
//
//     'Promise.resolve over a value that may already be a promise'   SC2020
//
// with the reason "wrap-or-identity depends on the runtime arm". That is a
// reason to TEST the arm, and this exact union is already tested elsewhere in
// the compiler: `await u` on it walks the tag, awaits the promise arm and
// re-tags the data arms (settleOrValueAwait). Promise.resolve is the same
// union asked the other question, so it takes the same walk with the wrap
// where the await was.
//
// Two properties this file exists to pin, both observable:
//
//   * IDENTITY. `Promise.resolve(p) === p` when the union carries the
//     promise (r02/r05) — an `async` wrapper would mint a second promise and
//     print false. Every scriptc promise is native, so the spec's
//     native-promise identity applies unchanged.
//   * The data arm does NOT await. `Promise.resolve(v)` fulfils at creation,
//     so the interleaving in r07 is Node's, not one microtask later. (The
//     await twin needs an `async.hop` there for precisely the opposite
//     reason.)
//
// r01-r08 are the rows that fail to build on main. r09-r12 are controls: the
// shapes Promise.resolve already lowered — a plain value, a plain promise
// (identity, which is where the identity rule comes from), no argument at
// all, and a union with NO promise arm.

// r01/r02 — wrap and identity, on the same union.
function pick(n: number): boolean {
    return process.argv.length > n
}

async function main(): Promise<void> {
    const p: Promise<number> = (async () => 7)()

    const carriesValue: number | Promise<number> = pick(99) ? p : 5
    const a = Promise.resolve(carriesValue)
    console.log("r01 " + String(a === p) + " " + String(await a))

    const carriesPromise: number | Promise<number> = pick(0) ? p : 5
    const b = Promise.resolve(carriesPromise)
    console.log("r02 " + String(b === p) + " " + String(await b))

    // r03 — the zapo shape: a payload that is either the bytes or a thunk
    // producing them, sync or async.
    async function resolvePayload(
        payload: Uint8Array | (() => Uint8Array | Promise<Uint8Array>),
    ): Promise<Uint8Array> {
        if (payload instanceof Uint8Array) {
            return Promise.resolve(payload)
        }
        return Promise.resolve(payload())
    }
    const direct = await resolvePayload(new Uint8Array([1, 2, 3]))
    const sync = await resolvePayload(() => new Uint8Array([4, 5]))
    const async1 = await resolvePayload(() => Promise.resolve(new Uint8Array([6])))
    console.log("r03 " + String(direct.length) + " " + String(sync.length) + " " + String(async1.length))

    // r04 — a string payload: the fulfil adapter differs per kind, so each
    // family is worth one row.
    const s: string | Promise<string> = pick(99) ? Promise.resolve("q") : "hello"
    console.log("r04 " + (await Promise.resolve(s)))

    // r05 — identity again, through a REFERENCE payload rather than a scalar.
    const bp: Promise<Uint8Array> = (async () => new Uint8Array([9]))()
    const ub: Uint8Array | Promise<Uint8Array> = pick(0) ? bp : new Uint8Array([1])
    const rb = Promise.resolve(ub)
    console.log("r05 " + String(rb === bp) + " " + String((await rb)[0]))

    // r06 — a union PAYLOAD: `Promise<T | null> | T | null`. The data side has
    // two arms, one of them a unit, so the walk has to re-tag into the
    // promise's own payload union rather than hand the arm back bare.
    function maybe(which: number): number | null | Promise<number | null> {
        if (which === 0) return 11
        if (which === 1) return null
        return (async () => 13 as number | null)()
    }
    const m0 = await Promise.resolve(maybe(0))
    const m1 = await Promise.resolve(maybe(1))
    const m2 = await Promise.resolve(maybe(2))
    console.log("r06 " + String(m0) + " " + String(m1) + " " + String(m2))

    // r07 — ordering. The data arm fulfils at creation, so awaiting it costs
    // the ONE tick an await always costs and no more; the tail of this
    // function must observe the same interleaving Node does.
    const order: string[] = []
    const vu: number | Promise<number> = pick(99) ? p : 1
    const rv = Promise.resolve(vu)
    void rv.then(() => {
        order.push("resolved")
    })
    await Promise.resolve(0)
    order.push("after-one-tick")
    await rv
    console.log("r07 " + order.join(","))

    // r08 — a rejection travelling through the identity arm keeps its
    // rejection: the promise passed through is the SAME promise, so the
    // failure is the original one.
    const bad: Promise<number> = (async () => {
        if (pick(0)) {
            throw new Error("boom")
        }
        return 0
    })()
    const ub2: number | Promise<number> = pick(0) ? bad : 3
    try {
        await Promise.resolve(ub2)
        console.log("r08 no-throw")
    } catch (e) {
        console.log("r08 " + (e instanceof Error ? e.message : "?"))
    }

    // r09 — CONTROL: a plain value.
    console.log("r09 " + String(await Promise.resolve(4)))

    // r10 — CONTROL: a plain promise. This is where the identity rule comes
    // from, and it must keep answering what it always answered.
    const p2: Promise<number> = (async () => 6)()
    const r10 = Promise.resolve(p2)
    console.log("r10 " + String(r10 === p2) + " " + String(await r10))

    // r11 — CONTROL: no argument at all.
    await Promise.resolve()
    console.log("r11 ok")

    // r12 — CONTROL: a union with NO promise arm is not this rule's business
    // and never was.
    const plain: number | string = pick(99) ? "s" : 12
    console.log("r12 " + String(await Promise.resolve(plain)))
}

void main()
