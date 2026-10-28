// new net.Socket() made inside a function through a namespace binding, then
// connect(port, host, listener) and a full exchange on the constructed socket.
import * as net from 'net'
const srv = net.createServer((c) => { c.on('error', () => {}); c.on('data', (d: Buffer) => c.end('echo:' + d)) })
function run(port: number) {
  const s = new net.Socket()
  s.connect(port, '127.0.0.1', () => { s.write('hi') })
  s.on('data', (d: Buffer) => console.log('got', String(d)))
  s.on('close', () => { console.log('closed'); srv.close(() => console.log('srv closed')) })
}
srv.listen(17917, '127.0.0.1', () => run(17917))
