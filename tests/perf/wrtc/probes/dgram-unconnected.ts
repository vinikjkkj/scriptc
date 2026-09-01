/* Control for dgram-named.ts. Same traffic, but UNCONNECTED: send with the
 * three-argument form the lowering supports. If this works, the dgram
 * plumbing (bind, message dispatch, the event loop) is fine and the ONLY
 * stage-2 gap is the connected-mode overload zapo uses. */
import { createSocket } from 'node:dgram'

const server = createSocket('udp4')
const client = createSocket('udp4')
let done = false

server.on('message', (msg: Buffer) => {
    if (done) return
    done = true
    const bytes: string[] = []
    for (const b of msg) bytes.push(String(b))
    console.log('server got: ' + bytes.join(','))
    server.close()
    client.close()
})

server.on('listening', () => {
    const port = server.address().port
    console.log('server listening')
    client.send(new Uint8Array([0x00, 0x01, 0x02, 0xfe, 0xff]), port, '127.0.0.1')
    console.log('client sent')
})

server.bind(0, '127.0.0.1')
