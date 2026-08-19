// The `ws`/undici INIT BAG carrying the two fields this compiler cannot
// honour — `dispatcher` and `agent` — with both ABSENT. It is the shape
// zapo's WaWebSocket.createRawSocket spells at its init-bag arm, and the
// only shape of that arm which lowers. (Measured: a FRESH zapo dial does
// not take that arm — no routing token means no headers means the plain
// two-argument form — in the Node lane and the compiled lane alike. The
// bag is compiled either way, and these guards are what the census counts.)
//
// The bag is lowered field by field (wsInitBagPlan): `protocols` and
// `headers` become the dial's two arguments, and a field with no lowering
// must be provably absent AT RUNTIME or the deferred fence fires. So the
// emitted wrapper carries one `if (present) throw` per unhonourable field,
// and this program is the proof that the guard is INERT when the field is
// undefined: the bag behaves exactly like the same bag without them, and
// exactly like Node.
//
// Those two throws were, until now, the only refusals in zapo's whole
// translation unit that no bracket-keyed instrument could see. They are
// raised by the BACKEND, from a ctor wrapper interned per construct
// SIGNATURE and reached only through a closure value, so they have no
// diagnostic and no source location of their own — and a refusal with no
// `[SCxxxx at file:line]` is invisible to the trap census, to a bracket
// grep, and to every reader who greps for one. The lowering now donates
// the site of the `globalThis.WebSocket` READ that interned the wrapper,
// which is the one real source location on the path.
//
// There is no server here (the corpus cannot host one): 127.0.0.1:1 is
// refused by both runtimes, which move readyState to CLOSED, fire `error`,
// then the abnormal close 1006.

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

// The bag zapo declares: two lowered fields and two proxy fields.
interface RawWSInit {
    readonly protocols?: string | readonly string[]
    readonly headers?: Readonly<Record<string, string>>
    readonly dispatcher?: object
    readonly agent?: object
}

type RawWSCtor = new (
    url: string,
    protocols?: string | readonly string[] | RawWSInit
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

function ctor(what: string, make: () => RawWS): void {
    try {
        const w = make()
        console.log(what, "accepted", w.readyState, w.binaryType)
    } catch (e) {
        console.log(what, "REFUSED", (e as Error).name + ": " + (e as Error).message)
    }
}

// Both proxy fields written and undefined — the runtime guards run and are
// false. This is the row.
ctor("both absent  ", () => new WS(DEAD, { headers: { "X-P": "1" }, dispatcher: undefined, agent: undefined }))

// One at a time, so a guard that fired for the wrong field would show.
ctor("dispatcher   ", () => new WS(DEAD, { protocols: "chat", dispatcher: undefined }))
ctor("agent        ", () => new WS(DEAD, { protocols: ["chat", "superchat"], agent: undefined }))

// The same bag with the fields omitted entirely — the control: the two
// spellings must be indistinguishable.
ctor("omitted      ", () => new WS(DEAD, { headers: { "X-P": "1" } }))

// A bag carrying nothing but the proxy fields, both absent: `protocols`
// and `headers` are the only lowered fields and neither is present.
ctor("proxy only   ", () => new WS(DEAD, { dispatcher: undefined, agent: undefined }))

const watched = new WS(DEAD, { headers: { "X-Watched": "1" }, dispatcher: undefined, agent: undefined })
watched.onerror = () => {
    console.log("error readyState", watched.readyState)
}
watched.onclose = (e) => {
    console.log("close", e.code, e.reason, e.wasClean, watched.readyState)
}
watched.onopen = () => {
    console.log("unexpected open")
}
