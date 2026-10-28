// A socket held through a dyn (any) binding reconnects with its listeners
// intact: the connect and close listeners run again on the new connection,
// and the close listener sees the boolean hadError each time.
import * as net from 'net'
const srv = net.createServer((c) => { c.on('error', () => {}); c.on('data', (d: Buffer) => c.end('echo:' + d)) })
srv.listen(17923, '127.0.0.1')
const c: any = net.connect(17923, '127.0.0.1')
let round = 0
c.on('connect', () => { console.log('c connect', round); c.write('x') })
c.on('data', (d: Buffer) => console.log('c data', String(d)))
c.on('close', (h: boolean) => {
  console.log('c close', h, round)
  if (round === 0) { round = 1; c.connect(17923, '127.0.0.1') }
  else { srv.close(() => console.log('srv closed')) }
})
