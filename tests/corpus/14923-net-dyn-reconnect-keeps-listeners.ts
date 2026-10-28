// A socket reconnects with its listeners intact: the connect and close
// listeners run again on the new connection, and the close listener sees the
// boolean hadError each time. The port is OS-assigned (port 0) and read back
// inside the listen callback, so concurrent lanes cannot collide.
import * as net from 'net'
const srv = net.createServer((c) => { c.on('error', () => {}); c.on('data', (d: Buffer) => c.end('echo:' + d)) })
srv.listen(0, '127.0.0.1', () => {
  const port = srv.address().port
  const c = new net.Socket()
  let round = 0
  c.on('connect', () => { console.log('c connect', round); c.write('x') })
  c.on('data', (d: Buffer) => console.log('c data', String(d)))
  c.on('close', (h: boolean) => {
    console.log('c close', h, round)
    if (round === 0) { round = 1; c.connect(port, '127.0.0.1') }
    else { srv.close(() => console.log('srv closed')) }
  })
  c.connect(port, '127.0.0.1')
})
