// The OTHER direction, and the one a delegation can break in silence: a
// bag whose `dispatcher` slot exists in the TYPE but holds `undefined` at
// run time must still DIAL. The oracle's dictionary fills the slot with
// the global dispatcher there and connects direct; scriptc's wrapper reads
// the union tag and dials.
//
// This is worth its own program because the failure is invisible from the
// other three. 6060, 6061 and 6062 all pass a live dispatcher, so a
// lowering that delegated UNCONDITIONALLY -- ignoring the tag -- would pass
// every one of them, and every program that meant "no proxy" would stop
// connecting. The reverse mistake (never delegating) is what the other
// three catch. Both are needed; neither is enough.
//
// The connection here is real and reaches the origin, so "it dialled" is
// not inferred from an absence.

import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import { createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

interface WaProxyDispatcher {
    dispatch(...args: readonly unknown[]): unknown
}
interface WsEvent {
    readonly data?: unknown
    readonly code?: number
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
interface WsInit {
    readonly protocols?: string | readonly string[]
    readonly headers?: Readonly<Record<string, string>>
    readonly dispatcher?: WaProxyDispatcher
}
type WsCtor = new (url: string, protocols?: string | readonly string[] | WsInit) => RawWebSocket

function headEnd(b: Buffer): number {
    for (let i = 0; i + 3 < b.length; i++) {
        if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i
    }
    return -1
}

const server = createServer((sock: Socket): void => {
    let buf = Buffer.alloc(0)
    let upgraded = false
    sock.on('data', (d: Buffer): void => {
        if (upgraded) return
        buf = Buffer.concat([buf, d])
        const i = headEnd(buf)
        if (i < 0) return
        upgraded = true
        const head = buf.subarray(0, i).toString('latin1')
        let key = ''
        let proto = ''
        for (const line of head.split('\r\n')) {
            const c = line.indexOf(':')
            if (c < 0) continue
            const name = line.slice(0, c).toLowerCase()
            if (name === 'sec-websocket-key') key = line.slice(c + 1).trim()
            // The subprotocol has to be ECHOED or the client treats the
            // handshake as failed, and this fixture would report an error
            // for a reason that has nothing to do with what it measures.
            if (name === 'sec-websocket-protocol') proto = line.slice(c + 1).trim()
        }
        // THE ASSERTION: the request got here, and it got here without any
        // dispatcher in the picture.
        console.log('origin reached directly, key length', key.length)
        const accept = createHash('sha1').update(key + GUID).digest('base64')
        sock.write(
            'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
                (proto === '' ? '' : 'Sec-WebSocket-Protocol: ' + proto + '\r\n') +
                'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
        )
        setTimeout((): void => {
            sock.end(Buffer.from([0x88, 0x00]))
        }, 40)
    })
    sock.on('error', (): void => {})
})

// `undefined`, and NOT the member being missing: the slot is in the record
// either way, so what is exercised is the runtime tag read.
const noProxy: WaProxyDispatcher | undefined = undefined

server.listen(0, '127.0.0.1', (): void => {
    const addr = server.address() as { readonly port: number }
    const C = (globalThis as typeof globalThis & { WebSocket?: WsCtor }).WebSocket
    if (!C) {
        throw new Error('no global WebSocket')
    }
    const ws = new C('ws://127.0.0.1:' + String(addr.port) + '/direct', {
        protocols: ['a'],
        dispatcher: noProxy
    })
    ws.onopen = (): void => {
        console.log('EVENT open readyState', ws.readyState)
    }
    ws.onmessage = (): void => {
        console.log('EVENT message')
    }
    ws.onerror = (): void => {
        console.log('EVENT error')
    }
    ws.onclose = (ev: WsEvent): void => {
        console.log('EVENT close code', ev.code, 'clean', ev.wasClean)
        server.close()
    }
})
