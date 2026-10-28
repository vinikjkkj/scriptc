// new (net.Socket)() — the parenthesized constructor — and a full exchange on
// the constructed socket, connect(port, host, listener) then write.
import * as net from 'net'
const srv = net.createServer((c) => { c.on('error', () => {}); c.on('data', (d: Buffer) => c.end('echo:' + d)) })
srv.listen(49918, '127.0.0.1', () => {
  const s = new (net.Socket)()
  s.connect(49918, '127.0.0.1', () => { s.write('hi') })
  s.on('data', (d: Buffer) => console.log('got', String(d)))
  s.on('close', () => { console.log('closed'); srv.close(() => console.log('srv closed')) })
})
