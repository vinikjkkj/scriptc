// `new WebSocket(url, initBag)` — the `ws`/undici INIT BAG in the SECOND
// position, and the options bag in the THIRD.
//
// The two are not the same argument and the two runtimes do not treat
// them the same way. Measured against Node v25.9.0, dialing a server that
// records the upgrade request:
//
//     new WS(url, undefined, { headers: { Cookie: 'x' } })   Cookie NOT sent
//     new WS(url, { headers: { Cookie: 'x' } })              Cookie SENT
//
// Node's global WebSocket takes (url, protocols|init) and ignores a third
// argument exactly as a browser does — so a program that puts headers in
// position three loses them on BOTH runtimes, and dropping it here is
// agreement with the oracle rather than a shortcut. The bag in position
// two is the overload that carries meaning, and it is lowered.
//
// There is no server here (the corpus cannot host one), so what this
// fixture pins is everything OBSERVABLE WITHOUT ONE: that every one of
// these constructor shapes is ACCEPTED and reaches the dial, and that the
// dial then fails identically. Before this lowering the second-position
// bag threw at the constructor instead — a refusal with no diagnostic and
// no source location, which is what makes it worth a fixture. The wire
// half (that the bag's headers actually go out) is driven by hand against
// a header-recording server; see estado-wsbag.md.
//
// The dial goes to 127.0.0.1:1, which nothing listens on: both
// implementations move readyState to CLOSED, fire `error`, then the
// abnormal close 1006.

interface WSEventLike {
    readonly code?: number
    readonly reason?: string
    readonly wasClean?: boolean
    readonly data?: unknown
}

interface RawWS {
    binaryType: string
    readyState: number
    onopen: ((e: WSEventLike) => void) | null
    onclose: ((e: WSEventLike) => void) | null
    onerror: ((e: WSEventLike) => void) | null
    onmessage: ((e: WSEventLike) => void) | null
    close(code?: number, reason?: string): void
    send(data: string | ArrayBuffer | Uint8Array): void
}

interface RawWSInit {
    readonly protocols?: string | readonly string[]
    readonly headers?: Readonly<Record<string, string>>
}

type RawWSCtor = new (
    url: string,
    protocols?: string | readonly string[] | RawWSInit,
    options?: { headers?: Readonly<Record<string, string>> }
) => RawWS

function globalWs(): RawWSCtor {
    const c = (globalThis as typeof globalThis & { WebSocket?: RawWSCtor }).WebSocket
    if (!c) {
        throw new Error("no global WebSocket")
    }
    return c
}

const WS = globalWs()
const DEAD = "ws://127.0.0.1:1/"

// Every shape below must be ACCEPTED — a constructor that throws is the
// regression this fixture exists to catch.
function ctor(what: string, make: () => RawWS): RawWS | null {
    try {
        const w = make()
        console.log(what, "accepted", w.readyState, w.binaryType)
        return w
    } catch (e) {
        console.log(what, "REFUSED", (e as Error).name + ": " + (e as Error).message)
        return null
    }
}

// The bag, in its four spellings.
ctor("bag empty     ", () => new WS(DEAD, {}))
ctor("bag headers   ", () => new WS(DEAD, { headers: { "X-Probe": "1", Cookie: "a=b" } }))
ctor("bag protocols ", () => new WS(DEAD, { protocols: "chat", headers: { "X-P": "1" } }))
ctor("bag proto list", () => new WS(DEAD, { protocols: ["chat", "superchat"] }))

// The plain second argument still reads the same three ways.
ctor("plain none    ", () => new WS(DEAD))
ctor("plain string  ", () => new WS(DEAD, "chat"))
ctor("plain list    ", () => new WS(DEAD, ["chat", "superchat"]))

// The THIRD argument: accepted and ignored, on both runtimes.
ctor("third options ", () => new WS(DEAD, undefined, { headers: { "X-Ignored": "1" } }))

// One socket carries the listeners, so the failure ordering is pinned
// without racing eight of them into the same log.
const watched = new WS(DEAD, { headers: { "X-Watched": "1" } })
watched.onerror = () => {
    console.log("error readyState", watched.readyState)
}
watched.onclose = (e) => {
    console.log("close", e.code, e.reason, e.wasClean, watched.readyState)
}
watched.onopen = () => {
    console.log("unexpected open")
}
