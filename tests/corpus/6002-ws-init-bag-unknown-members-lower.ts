// An init bag carrying members with no WebSocket meaning at all.
//
// 6000 pins that the oracle IGNORES the bag members it does not read. This
// pins the consequence for the LOWERING: a bag is lowerable when scriptc can
// account for `protocols`, `headers` and `dispatcher`, and the other members
// are not something to account for -- they are something to skip. Nothing
// about their TYPES can make the bag unlowerable, because nothing ever looks
// at them.
//
// That used to be the other way round. The plan required every member it did
// not recognise to be optional, so that it could plant a runtime "was this
// supplied?" test; a member that could not be absent -- a required
// `maxPayload: number` here -- had no such test to plant, and the whole bag
// was declined. Declining the bag is not a small thing: the construct falls
// back to the unconditional fence, so the program does not dial, it dies,
// with `the 'ws' package's option-bag second argument ... has no scriptc
// lowering yet` and exit 1, on both lanes. Against a runtime that never
// reads the member at all.
//
// The dial goes to 127.0.0.1:1, which nothing listens on, so what this
// fixture reads back is the same abnormal-close pair 2747 reads back -- the
// point being that it reads back anything at all.

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

interface AgentLike {
    readonly addRequest: (req: unknown, opts: unknown) => void
}

// Six members. Two are read (`protocols`, `headers`); four are the `ws`
// package's own options, and among them `maxPayload` and `handshakeTimeout`
// are REQUIRED, which is what used to make the whole bag unlowerable.
interface WsPackageInit {
    readonly protocols?: string | readonly string[]
    readonly headers?: Readonly<Record<string, string>>
    readonly agent?: AgentLike
    readonly origin?: string
    readonly maxPayload: number
    readonly handshakeTimeout: number
}

type RawWSCtor = new (url: string, protocols?: string | readonly string[] | WsPackageInit) => RawWS

function globalWs(): RawWSCtor {
    const c = (globalThis as typeof globalThis & { WebSocket?: RawWSCtor }).WebSocket
    if (!c) {
        throw new Error("no global WebSocket")
    }
    return c
}

const WS = globalWs()

let addRequestCalls = 0

const sock = new WS("ws://127.0.0.1:1/", {
    protocols: ["chat"],
    headers: { "X-Corpus": "6002" },
    agent: {
        addRequest: (_req: unknown, _opts: unknown): void => {
            addRequestCalls += 1
        }
    },
    origin: "http://corpus.invalid",
    maxPayload: 1048576,
    handshakeTimeout: 250
})

// The bag was honoured for the parts that mean something: the socket exists
// and starts in the ordinary state.
console.log("binaryType", sock.binaryType)
console.log("readyState", sock.readyState)

sock.onopen = (): void => {
    console.log("open")
}
sock.onerror = (): void => {
    console.log("error@" + String(sock.readyState))
}
sock.onclose = (e: WSEventLike): void => {
    console.log("close@" + String(sock.readyState) + " code=" + String(e.code))
    console.log("addRequest calls", addRequestCalls)
}
