/* Stage 2's real prerequisite.
 *
 * Finding 3 of stage 0: zapo's FNA relay path never constructs a peer
 * connection. It runs its own 567-line TypeScript STUN stack over a raw
 * node:dgram socket in CONNECTED mode -- WaSctpRelay.ts:442-:466 does
 *
 *     const socket = dgram.createSocket(isIPv6(ip) ? 'udp6' : 'udp4')
 *     socket.on('message', ...)
 *     socket.connect(port, ip, () => { ... })
 *
 * and sends with the single-argument form, WaSctpRelay.ts:663:
 *
 *     conn.udpSocket.send(new Uint8Array(data))
 *
 * So the question stage 2 actually turns on is not "can scriptc do ICE"
 * but "does connected-mode node:dgram work, including the one-argument
 * send". This answers it over loopback, and PRINTS the bytes that arrive
 * rather than asserting a callback fired -- a receive callback that runs
 * with the wrong payload looks identical to a correct one otherwise.
 */

import dgram from 'node:dgram'

const server = dgram.createSocket('udp4')
const client = dgram.createSocket('udp4')

let done = false

function finish(): void {
    if (done) return
    done = true
    server.close()
    client.close()
}

server.on('message', (msg: Buffer) => {
    // Print the payload as bytes, not as a length: a truncated or
    // misaligned datagram has the right length surprisingly often.
    const bytes: string[] = []
    for (const b of msg) bytes.push(String(b))
    console.log('server got: ' + bytes.join(','))
    finish()
})

server.on('listening', () => {
    const port = server.address().port
    client.connect(port, '127.0.0.1', () => {
        console.log('client connected')
        // The single-argument send, connected mode -- zapo's exact form.
        client.send(new Uint8Array([0x00, 0x01, 0x02, 0xfe, 0xff]))
        console.log('client sent')
    })
})

server.bind(0, '127.0.0.1')
