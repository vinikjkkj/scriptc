// A dispatcher that does NOT deliver a socket. Three ways, and the one
// thing that must be true of all of them: the origin is never reached.
//
// MEASURED against Node v25.9.0 (tests/harness/ws-dispatcher.test.ts
// re-measures on every gate):
//
//   handler.onError(err)             -> `error`, then close 1006, not clean
//   dispatch throws                  -> `error`, then close 1006, not clean
//   dispatch returns, says nothing   -> NOTHING, ever
//
// The middle one is the one worth a program. A throw out of `dispatch`
// happens inside `new WebSocket(...)`, and the oracle does not let it out
// of the constructor -- it catches it and fails the connection instead. A
// runtime that let the exception ride out would diverge twice over: the
// `new` would throw where the oracle's returns, and the WebSocket object
// the program is holding would never settle at all.
//
// The third is the shape with no events, which is exactly why it is here:
// "no output" is indistinguishable from "the program crashed before
// printing" unless something else prints afterwards. The final line does.
//
// No server, no port, no socket: nothing in this program dials, because
// nothing is supposed to. That is the assertion.

interface WsEvent {
    readonly data?: unknown
    readonly code?: number
    readonly reason?: string
    readonly wasClean?: boolean
}
interface RawWebSocket {
    binaryType: string
    readyState: number
    onopen: ((ev: WsEvent) => void) | undefined
    onmessage: ((ev: WsEvent) => void) | undefined
    onclose: ((ev: WsEvent) => void) | undefined
    onerror: ((ev: WsEvent) => void) | undefined
    send: (data: string) => void
    close: (code?: number, reason?: string) => void
}
interface Dispatcher {
    dispatch(...args: readonly unknown[]): unknown
}
interface WsInit {
    readonly protocols?: string | readonly string[]
    readonly headers?: Readonly<Record<string, string>>
    readonly dispatcher?: Dispatcher
}
type WsCtor = new (url: string, protocols?: string | readonly string[] | WsInit) => RawWebSocket

interface UndiciHandler {
    readonly onError: (err: unknown) => void
}

function ctor(): WsCtor {
    const c = (globalThis as typeof globalThis & { WebSocket?: WsCtor }).WebSocket
    if (!c) {
        throw new Error('no global WebSocket')
    }
    return c
}

// A high unassigned port with nothing on it. NOT a low one: fetch's
// blocked-port list swallows the request before the dispatcher is ever
// called (ws://127.0.0.1:9 answers error + close 1006 with dispatch never
// reached -- measured, and it cost a rewrite of this fixture). If any of
// these dialled, the connection would be REFUSED and the silent row below
// would report events instead of nothing.
const DEAD_URL = 'ws://127.0.0.1:47129/never'

function watch(label: string, ws: RawWebSocket): void {
    ws.onopen = (): void => {
        console.log(label, 'open')
    }
    ws.onerror = (): void => {
        console.log(label, 'error')
    }
    ws.onclose = (ev: WsEvent): void => {
        console.log(label, 'close', ev.code, ev.wasClean)
    }
}

const errorer: Dispatcher = {
    dispatch(...args: readonly unknown[]): unknown {
        const handler = args[1] as UndiciHandler
        handler.onError(new Error('the proxy refused'))
        return true
    }
}

const thrower: Dispatcher = {
    dispatch(...args: readonly unknown[]): unknown {
        console.log('thrower reached, argc', args.length)
        throw new Error('the proxy exploded')
    }
}

const silent: Dispatcher = {
    dispatch(...args: readonly unknown[]): unknown {
        console.log('silent reached, argc', args.length)
        return true
    }
}

const C = ctor()
watch('errorer', new C(DEAD_URL, { dispatcher: errorer }))
watch('thrower', new C(DEAD_URL, { dispatcher: thrower }))
watch('silent', new C(DEAD_URL, { dispatcher: silent }))

setTimeout((): void => {
    console.log('done -- and the silent one printed nothing, which is the point')
}, 300)
