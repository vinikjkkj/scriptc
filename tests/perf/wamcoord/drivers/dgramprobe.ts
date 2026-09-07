// Minimal UDP program, DEFAULT backend, to observe on THIS host whether a
// dgram program stays on the LLVM tier or silently demotes to C.
import dgram from 'node:dgram'

const s = dgram.createSocket('udp4')
s.bind(0, '127.0.0.1', () => {
    const a = s.address()
    console.log('bound=' + (a.port > 0 ? 'yes' : 'no'))
    s.close()
})
