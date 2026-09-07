// The dgram surface voip ACTUALLY uses, not a hello-world. If this stays on the
// LLVM tier too, the recorded "every UDP build silently demotes to C" is dead
// for voip's surface and not merely for a minimal one.
import dgram from 'node:dgram'

const s = dgram.createSocket('udp4')
let got = 0
s.on('error', (e: Error) => { console.log('err=' + e.message) })
s.on('message', (msg: Buffer) => {
    got += msg.length
    console.log('msg=' + got)
    s.close()
})
s.on('listening', () => {
    const a = s.address()
    console.log('port>0=' + (a.port > 0))
    s.send(Buffer.from([1, 2, 3]), a.port, '127.0.0.1')
})
s.bind(0, '127.0.0.1')
