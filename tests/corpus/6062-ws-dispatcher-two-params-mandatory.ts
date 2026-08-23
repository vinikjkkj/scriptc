// The SAME delegation through the OTHER two shapes the plan admits, so
// neither is only ever exercised by reasoning:
//
//   - `dispatch(opts, handler): boolean` -- two DECLARED parameters and a
//     non-dyn return, where 6060 has a rest parameter and `unknown`. The
//     two lower to different C signatures (two ScrDyn* against one packed
//     dyn array; a bool return against a pointer), and a closure called
//     through the wrong one is undefined behaviour rather than a
//     diagnosable failure -- which is why the compiler proves the shape
//     and passes the arm down instead of the runtime guessing it.
//
//   - a MANDATORY `dispatcher`, with no undefined arm. Before the
//     delegation existed a slot with no absence had no lowerable state at
//     all, so the whole bag was declined and the site took the
//     unconditional fence: the program did not dial, it DIED. Now there is
//     nothing to be absent about -- it always delegates.
import { createServer, connect } from 'node:net'
import type { Socket } from 'node:net'
import { createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

interface WaProxyDispatcher {
    dispatch(opts: unknown, handler: unknown): boolean
}
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
interface WsInit {
    readonly protocols?: string | readonly string[]
    readonly headers?: Readonly<Record<string, string>>
    readonly dispatcher: WaProxyDispatcher
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
        for (const line of head.split('\r\n')) {
            const c = line.indexOf(':')
            if (c > 0 && line.slice(0, c).toLowerCase() === 'sec-websocket-key') {
                key = line.slice(c + 1).trim()
            }
        }
        console.log('server saw upgrade, key length', key.length)
        const accept = createHash('sha1').update(key + GUID).digest('base64')
        sock.write(
            'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
                'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
        )
        setTimeout((): void => {
            const payload = Buffer.from('hello-from-proxy')
            sock.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]))
            setTimeout((): void => {
                sock.end(Buffer.from([0x88, 0x00]))
            }, 30)
        }, 30)
    })
    sock.on('error', (): void => {})
})

const dispatcher: WaProxyDispatcher = {
    dispatch(rawOpts: unknown, rawHandler: unknown): boolean {
        const opts = rawOpts as {
            readonly path: string
            readonly origin: string
            readonly method: string
            readonly upgrade: string
            readonly maxRedirections: number
            readonly headers: Readonly<Record<string, string>>
        }
        const handler = rawHandler as {
            readonly onUpgrade: (status: number, headers: readonly unknown[], socket: unknown) => void
            readonly onError: (err: unknown) => void
        }
        console.log('dispatch called, two declared parameters')
        console.log('opts', opts.method, opts.path, opts.upgrade, opts.maxRedirections)
        console.log('opts.origin starts with http://', opts.origin.indexOf('http://') === 0)
        const names: string[] = []
        // sec-websocket-extensions is DELIBERATELY absent from scriptc's
        // opts and present in the oracle's -- scr_websocket.c has no
        // inflate, so offering permessage-deflate would risk a compressed
        // frame it would read as garbage. The omission is asserted by
        // tests/harness/ws-dispatcher.test.ts; here it is filtered so this
        // program measures everything ELSE byte for byte.
        for (const k in opts.headers) if (k !== 'sec-websocket-extensions') names.push(k)
        console.log('opts.headers', names.join(','))
        console.log('key len', String(opts.headers['sec-websocket-key']).length)

        const sock = connect(port, '127.0.0.1')
        sock.on('connect', (): void => {
            let req = 'GET ' + opts.path + ' HTTP/1.1\r\nHost: 127.0.0.1\r\n'
            for (const k in opts.headers) req += k + ': ' + String(opts.headers[k]) + '\r\n'
            req += 'Connection: upgrade\r\nUpgrade: ' + opts.upgrade + '\r\n\r\n'
            sock.write(req)
        })
        let buf = Buffer.alloc(0)
        let done = false
        sock.on('data', (d: Buffer): void => {
            if (done) return
            buf = Buffer.concat([buf, d])
            const i = headEnd(buf)
            if (i < 0) return
            done = true
            const head = buf.subarray(0, i).toString('latin1')
            const rest = buf.subarray(i + 4)
            const lines = head.split('\r\n')
            const status = Number(lines[0].split(' ')[1])
            const hdrs: string[] = []
            for (const line of lines.slice(1)) {
                const c = line.indexOf(':')
                if (c > 0) {
                    hdrs.push(line.slice(0, c))
                    hdrs.push(line.slice(c + 1).trim())
                }
            }
            console.log('proxy got status', status, 'trailing bytes', rest.length)
            if (rest.length > 0) sock.unshift(rest)
            handler.onUpgrade(status, hdrs, sock)
        })
        sock.on('error', (e: Error): void => {
            handler.onError(e)
        })
        return true
    }
}

let port = 0
server.listen(0, '127.0.0.1', (): void => {
    const addr = server.address() as { readonly port: number }
    port = addr.port
    const Ctor = (globalThis as typeof globalThis & { WebSocket?: WsCtor }).WebSocket
    if (!Ctor) {
        throw new Error('no global WebSocket')
    }
    const ws = new Ctor('ws://127.0.0.1:' + String(port) + '/probe', { dispatcher })
    ws.onopen = (): void => {
        console.log('EVENT open readyState', ws.readyState)
    }
    ws.onmessage = (ev: WsEvent): void => {
        console.log('EVENT message', String(ev.data))
    }
    ws.onerror = (): void => {
        console.log('EVENT error')
    }
    ws.onclose = (ev: WsEvent): void => {
        console.log('EVENT close code', ev.code, 'clean', ev.wasClean)
        server.close()
    }
})
