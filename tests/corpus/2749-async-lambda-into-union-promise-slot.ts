// An ASYNC lambda whose SLOT spells the promise inside a union — the
// optional-handler idiom every transport is written in:
//
//     readonly onOpen?: (info: Info) => void | Promise<void>
//     handlers.onOpen = async () => { await something() }
//
// The slot's return maps to the IR union `Promise<void> | undefined`.
// A contextually-typed lambda adopts its slot's union return so the
// closure VALUE matches the slot exactly, but an ASYNC lambda must adopt
// through the PROMISE: what its body fulfils with is the promise arm's
// inner type, never the whole union — an async function's value is always
// a promise, so `undefined` is not one of its outcomes. Adopting the
// union verbatim gave the lambda the ABI
// `() => Promise<Promise<void> | undefined>`, which is assignable to no
// slot at all, and the invocation stranded with a TypeError at the first
// event.
//
// What is pinned here is the RESULT: the handler runs, its awaited
// continuation resumes in the right microtask turn, a payload-carrying
// slot hands its value back, and a rejection still reaches the catch.
// Arity is a separate, already-settled story
// (2707-callback-arity-into-union-arm) and rides along: every handler
// below declares fewer parameters than its slot, which is exactly what a
// handler that ignores its event argument looks like.

interface Info {
    readonly openedAt: number
}

interface Handlers {
    readonly onOpen?: (info: Info) => void | Promise<void>
    readonly onTick?: (n: number, label: string) => void
}

async function step(tag: string): Promise<void> {
    console.log("step", tag)
}

// The zero-parameter async handler in a one-parameter optional slot, and
// a sync handler one parameter short of a two-parameter slot beside it.
const handlers: Handlers = {
    onOpen: async () => {
        await step("open")
        console.log("open resumed")
    },
    onTick: (n) => {
        console.log("tick", n)
    }
}

// The transport's own spelling: an optional call whose result is voided.
void handlers.onOpen?.({ openedAt: 1 })
handlers.onTick?.(3, "ignored")

// A slot whose promise arm CARRIES a payload: here the adoption must fire
// and hand the body the arm's inner union, not decline.
type PayloadHandler = (n: number) => Promise<string | number> | undefined
const payload: PayloadHandler = async () => {
    await step("payload")
    return "carried"
}

// A rejection travels through the adapter unchanged.
type OpenHandler = (info: Info) => void | Promise<void>
const thrower: OpenHandler = async () => {
    throw new Error("handler failed")
}

// A plain SYNC handler in the same void|Promise slot keeps working.
const sync: OpenHandler = () => {
    console.log("sync handler")
}
void sync({ openedAt: 2 })

const pending = payload(5)
if (pending) {
    void pending.then((v) => {
        console.log("payload gave", v)
    })
}

const rejected = thrower({ openedAt: 3 })
if (rejected) {
    void rejected.catch((e: unknown) => {
        console.log("caught", (e as Error).message)
    })
}

console.log("sync phase done")
