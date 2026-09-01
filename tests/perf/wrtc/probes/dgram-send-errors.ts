/* The error paths of the connected send, scored against Node.
 *
 * A lowering that only gets the happy path right is worse than a refusal:
 * it turns a loud "no lowering" into a quiet wrong answer.
 *
 * Node validates the ABSENT port argument before it looks at connection
 * or running state, so both an unconnected and a closed socket answer
 * ERR_SOCKET_BAD_PORT rather than the connection/running error a reader
 * would expect. Verified against node v25.9.0.
 */
import dgram from 'node:dgram'

function show(label: string, e: unknown): void {
    console.log(label + ': ' + (e instanceof Error ? String(e) : String(e)))
}

// 1. never connected
const a = dgram.createSocket('udp4')
try {
    a.send(new Uint8Array([1, 2, 3]))
    console.log('unconnected: NO THROW')
} catch (e) {
    show('unconnected', e)
}
a.close()

// 2. closed, never connected
const b = dgram.createSocket('udp4')
b.close()
try {
    b.send(new Uint8Array([1]))
    console.log('closed: NO THROW')
} catch (e) {
    show('closed', e)
}

// 3. the string arm over a real connected socket
const srv = dgram.createSocket('udp4')
const cli = dgram.createSocket('udp4')
srv.on('message', (msg: Buffer) => {
    console.log('got string payload: ' + msg.toString())
    srv.close()
    cli.close()
})
srv.on('listening', () => {
    cli.connect(srv.address().port, '127.0.0.1', () => {
        cli.send('hello-connected')
    })
})
srv.bind(0, '127.0.0.1')
