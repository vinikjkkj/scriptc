// The `ws` option bag's `dispatcher`, and what "absent" means for it.
//
// `dispatcher` is the one bag member the oracle both READS and HONOURS: a
// live one takes the entire upgrade -- `dispatcher.dispatch(opts, handler)`
// is called and the connection never reaches the origin at all. scriptc has
// no lowering for that, so it refuses; the interesting question is which
// values count as "no dispatcher" and may therefore dial DIRECT.
//
// Exactly one does: `undefined` (and the member being missing, which is the
// same thing to a WebIDL dictionary). Every other value is an error,
// because the dictionary default fills the slot BEFORE the implementation
// asserts the dispatcher truthy -- so `null`, `0`, `false`, `''` and `NaN`
// all throw rather than falling back to a direct connection.
//
// That distinction is the whole fixture. A compiler that tested the slot
// for TRUTHINESS instead of for `undefined` would agree with the oracle on
// the first row and, on all five of the others, quietly open a DIRECT
// connection where the oracle refuses to open anything. A connection that
// silently ignores the proxy it was told to use is the failure this fence
// exists to prevent, and it is invisible in any output that only records
// what a successful dial printed.
//
// Only "did it connect, or did it throw" is compared. The two runtimes
// raise different error TYPES (the oracle's assertion vs. this compiler's
// refusal), and pinning either one's message would pin a wording rather
// than the contract; what has to agree, and what a wrong answer breaks, is
// whether a socket was opened.

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

// `dispatcher?: unknown` -- the checked-dynamic slot, which is the spelling
// that lets one program write every one of the six values below into the
// same field. A statically typed `Dispatcher | undefined` can only ever
// hold two of them, and it is the other four that used to slip through.
interface RawWSInit {
    readonly protocols?: string | readonly string[]
    readonly headers?: Readonly<Record<string, string>>
    readonly dispatcher?: unknown
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

/** "opened" when a socket came back, "threw" when none did. Deliberately
 * NOT the error's name or message: the oracle throws an assertion and this
 * compiler throws its refusal, and the contract is that neither of them
 * connects. */
function attempt(init: RawWSInit): string {
    let sock: RawWS
    try {
        sock = new WS("ws://127.0.0.1:1/", init)
    } catch (e) {
        void (e as Error)
        return "threw"
    }
    // Close it immediately: a fixture must not leave a dial on the loop.
    sock.onerror = (): void => {}
    sock.onclose = (): void => {}
    sock.close(1000, "done")
    return "opened"
}

const headers: Readonly<Record<string, string>> = { "X-Corpus": "6001" }

// The one value that means "no dispatcher": the dial goes direct.
console.log("undefined ", attempt({ protocols: "chat", headers, dispatcher: undefined }))
// …and the member left out entirely, which a dictionary reads the same way.
console.log("missing   ", attempt({ protocols: "chat", headers }))

// Every falsy NON-undefined value. None of these may open a socket.
console.log("null      ", attempt({ protocols: "chat", headers, dispatcher: null }))
console.log("zero      ", attempt({ protocols: "chat", headers, dispatcher: 0 }))
console.log("false     ", attempt({ protocols: "chat", headers, dispatcher: false }))
console.log("empty str ", attempt({ protocols: "chat", headers, dispatcher: "" }))
console.log("NaN       ", attempt({ protocols: "chat", headers, dispatcher: NaN }))

// NOT pinned here, and it is worth saying why: a TRUTHY non-dispatcher --
// `{}`, say, an object with no `dispatch` method -- is a divergence in
// TIMING that this fixture's shape cannot express. The oracle's constructor
// accepts it and returns a socket, then fails asynchronously when it tries
// to dispatch through it (measured: no connection ever reaches the origin);
// scriptc refuses synchronously from the construct. Both decline to open
// that connection, which is the contract, but one says so before returning
// and the other after, so an "opened"/"threw" row would disagree there
// alone. The refusal is the loud side of the divergence, which is the side
// this project takes.
