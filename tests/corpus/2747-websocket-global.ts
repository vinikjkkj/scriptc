// globalThis.WebSocket — the WHATWG global, reached the only way a
// program with no lib.dom can reach it: a cast of globalThis carrying the
// program's own declaration of the API. There is no server here, so what
// this fixture pins is everything OBSERVABLE WITHOUT ONE — the identity
// of the global, the constructor's URL steps, the API object's initial
// state, and the two argument ladders send/close run before anything
// reaches the wire. The socket half (handshake, frames, close codes,
// wss:// against a real endpoint) is driven by hand against a live `ws`
// server; the corpus cannot host one.
//
// The dial that DOES happen goes to 127.0.0.1:1, which is not a port
// anything listens on: both implementations report the same failure the
// same way — readyState moves to CLOSED, then an `error` event, then the
// abnormal close 1006. The ORDER is observable: the error listener reads
// readyState 3, not 0.

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

type RawWSCtor = new (url: string, protocols?: string | readonly string[]) => RawWS

function globalWs(): RawWSCtor {
    const c = (globalThis as typeof globalThis & { WebSocket?: RawWSCtor }).WebSocket
    if (!c) {
        throw new Error("no global WebSocket")
    }
    return c
}

// ONE object: two reads of the global compare equal, the way they do in
// every runtime that has one (zapo's transport compares the constructor
// it was handed against the global one).
const WS = globalWs()
console.log("identity", WS === globalWs())

// The URL steps. http:/https: are REMAPPED to ws:/wss: rather than
// rejected; anything else, an unparseable URL, and a fragment are all
// SyntaxError — never the TypeError the URL parser itself would raise.
function ctorErr(url: string): string {
    try {
        const w = new WS(url)
        w.close(1000, "ok")
        return "accepted"
    } catch (e) {
        return (e as Error).name + ": " + (e as Error).message
    }
}
console.log("bad url  ", ctorErr("not a url"))
console.log("ftp      ", ctorErr("ftp://example.test/"))
console.log("fragment ", ctorErr("ws://127.0.0.1:1/#x"))

const sock = new WS("ws://127.0.0.1:1/")

// The initial state of a freshly constructed socket.
console.log("binaryType", sock.binaryType)
console.log("readyState", sock.readyState)
console.log(
    "handlers",
    sock.onopen === null,
    sock.onclose === null,
    sock.onerror === null,
    sock.onmessage === null,
)
console.log("methods", typeof sock.send, typeof sock.close)

// send() before the handshake completes is an InvalidStateError, in the
// browser and in Node alike — not a buffered write.
try {
    sock.send("early")
    console.log("early send accepted")
} catch (e) {
    console.log("early send", (e as Error).name + ": " + (e as Error).message)
}

// close() validates its arguments before anything reaches the wire: only
// 1000 and 3000..4999 are codes a script may send, and a reason is capped
// at 123 UTF-8 bytes.
function closeErr(code: number, reason: string): string {
    try {
        sock.close(code, reason)
        return "accepted"
    } catch (e) {
        return (e as Error).name + ": " + (e as Error).message
    }
}
console.log("close 1006", closeErr(1006, "x"))
console.log("close 2999", closeErr(2999, "x"))
console.log("close 5000", closeErr(5000, "x"))
console.log("close long", closeErr(1000, "y".repeat(124)))

// binaryType is an ordinary writable slot.
sock.binaryType = "arraybuffer"
console.log("binaryType", sock.binaryType)

// The dial cannot succeed; both implementations report it the same way.
sock.onerror = () => {
    console.log("error readyState", sock.readyState)
}
sock.onclose = (e) => {
    console.log("close", e.code, e.reason, e.wasClean, sock.readyState)
}
sock.onopen = () => {
    console.log("unexpected open")
}
