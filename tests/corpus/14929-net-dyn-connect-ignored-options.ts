// connect(port, host) on a typed socket, with its 'connect' and 'close'
// listeners. The port is OS-assigned and read back inside the listen
// callback. (The options-object form of connect is refused at compile time
// on a typed socket, SC2002, so it is not in the corpus; it is OPEN.)
import * as net from 'net'
const srv = net.createServer((c) => { c.on('error', () => {}); c.end('bye') })
srv.listen(0, '127.0.0.1', () => {
  const port = srv.address().port
  const d = new net.Socket()
  d.on('connect', () => { console.log('connect'); d.destroy() })
  d.on('close', (h: boolean) => { console.log('close', h); srv.close(() => console.log('srv closed')) })
  d.connect(port, '127.0.0.1')
})
