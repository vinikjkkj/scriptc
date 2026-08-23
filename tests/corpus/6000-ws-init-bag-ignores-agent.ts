// The `ws` option bag's `agent`, and every other name that is NOT one of
// the three the oracle reads.
//
// `globalThis.WebSocket` takes an INIT BAG in the second position, and that
// bag is a WebIDL dictionary with exactly three members: `protocols`,
// `headers` and `dispatcher`. Every other member of the object is ignored
// -- not tolerated, IGNORED: the implementation never reads the property at
// all. `agent`, `origin`, `ca`, `rejectUnauthorized`, `perMessageDeflate`
// and the rest of that list are the `ws` PACKAGE's options, and the `ws`
// package is not what this constructor is.
//
// scriptc used to REFUSE a bag whose `agent` was live, planting a tagged
// SC2020 in the emitted C. That was a refusal where the oracle connects,
// which is the expensive direction of wrong: the program does not run at
// all. What this fixture pins is that the ignored members are ignored the
// way Node ignores them -- the dial happens, and the agent is never touched.
//
// No server here, by the corpus's usual trick: 127.0.0.1:1 has nothing on
// it, so both implementations report the same failure the same way, and
// "the dial happened" is observable as the error/close pair rather than as
// a connection. A refusal would print none of it.

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

// The proxy shapes zapo declares: structural minimums, one method each.
interface ProxyAgentLike {
    readonly addRequest: (req: unknown, opts: unknown) => void
}

interface RawWSInit {
    readonly protocols?: string | readonly string[]
    readonly headers?: Readonly<Record<string, string>>
    readonly dispatcher?: ProxyAgentLike
    readonly agent?: ProxyAgentLike
}

type RawWSCtor = new (url: string, protocols?: string | readonly string[] | RawWSInit) => RawWS

function globalWs(): RawWSCtor {
    const c = (globalThis as typeof globalThis & { WebSocket?: RawWSCtor }).WebSocket
    if (!c) {
        throw new Error("no global WebSocket")
    }
    return c
}

const WS = globalWs()

// A LIVE agent. Its one method records a call, so "the implementation never
// reads this member" is asserted against behaviour and not against a
// promise: if either side ever routed the dial through it, the counter
// below would move.
let addRequestCalls = 0
const agent: ProxyAgentLike = {
    addRequest: (_req: unknown, _opts: unknown): void => {
        addRequestCalls += 1
    }
}

// Two dials that must be indistinguishable: the same bag, once without the
// ignored member and once with it live.
const withoutAgent: RawWSInit = {
    protocols: ["chat"],
    headers: { "X-Corpus": "6000" }
}
const withAgent: RawWSInit = {
    protocols: ["chat"],
    headers: { "X-Corpus": "6000" },
    agent
}

function dial(label: string, init: RawWSInit): Promise<string> {
    return new Promise<string>((resolve) => {
        // The construct itself: a refusal would throw right here, and the
        // catch prints a line neither the oracle nor a fixed compiler does.
        let sock: RawWS
        try {
            sock = new WS("ws://127.0.0.1:1/", init)
        } catch (e) {
            resolve(label + " REFUSED " + (e as Error).name)
            return
        }
        // Initial state is the ordinary one: an init bag does not change it.
        console.log(label, "binaryType", sock.binaryType)
        console.log(label, "readyState", sock.readyState)
        const events: string[] = []
        sock.onopen = (): void => {
            events.push("open")
        }
        sock.onerror = (): void => {
            // The ORDER matters: the error listener sees CLOSED, not
            // CONNECTING, in both implementations.
            events.push("error@" + String(sock.readyState))
        }
        sock.onclose = (e: WSEventLike): void => {
            events.push("close@" + String(sock.readyState) + " code=" + String(e.code))
            resolve(label + " " + events.join(","))
        }
    })
}

async function main(): Promise<void> {
    const a = await dial("plain", withoutAgent)
    const b = await dial("agent", withAgent)
    console.log(a)
    console.log(b)
    // The two dials differ only in a member nobody reads, so their event
    // sequences are the same string once the label is stripped.
    console.log("same sequence", a.slice("plain".length) === b.slice("agent".length))
    console.log("addRequest calls", addRequestCalls)
}

void main()
