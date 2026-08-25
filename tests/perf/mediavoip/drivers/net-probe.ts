import dgram from 'node:dgram'
import { isIPv6 } from 'node:net'
console.log('isIPv6(::1) =', isIPv6('::1'))
console.log('isIPv6(127.0.0.1) =', isIPv6('127.0.0.1'))
const sock = dgram.createSocket('udp4')
sock.on('message', (msg: Buffer, rinfo: { address: string; port: number }) => {
    console.log('recv', msg.length, 'from', rinfo.address, rinfo.port)
    sock.close()
})
sock.bind(0, '127.0.0.1', () => {
    const addr = sock.address()
    console.log('bound', addr.address, addr.port)
    sock.send(new Uint8Array([1, 2, 3, 4]), addr.port, '127.0.0.1')
})
