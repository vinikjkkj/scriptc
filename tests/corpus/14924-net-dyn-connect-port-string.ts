// A socket's connect() with a numeric port and a host, and its 'connect'
// listener. The port is OS-assigned and read back inside the listen callback.
// (The numeric-string port form is measured by probes; the corpus program
// stays typed so that it cannot be refused at compile time.)
import * as net from 'net'
const srv = net.createServer((c) => { c.on('error', () => {}); c.end('bye') })
srv.listen(0, '127.0.0.1', () => {
  const port = srv.address().port
  const d = new net.Socket()
  d.on('connect', () => { console.log('connect'); d.destroy() })
  d.on('close', (h: boolean) => { console.log('close', h); srv.close(() => console.log('srv closed')) })
  d.connect(port, '127.0.0.1')
})
