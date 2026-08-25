import dgram from 'node:dgram'
const sock = dgram.createSocket('udp4')
sock.on('message', (msg: Buffer, rinfo) => {
    console.log('recv', msg.length, 'from', rinfo.address, rinfo.port)
    sock.close()
})
sock.bind(0, '127.0.0.1', () => {
    const addr = sock.address()
    console.log('bound', addr.address, addr.port)
    sock.send(new Uint8Array([1, 2, 3, 4]), addr.port, '127.0.0.1')
})
