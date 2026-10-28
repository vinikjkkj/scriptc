// new Socket() through the named import, connect({ port, host }, listener)
// and end(data) answered by the server.
import { Socket, createServer } from 'net'
const srv = createServer((c) => { c.on('error', () => {}); c.on('data', (d: Buffer) => c.end('echo:' + d)) })
srv.listen(17919, '127.0.0.1', () => {
  const s = new Socket()
  s.connect({ port: 17919, host: '127.0.0.1' }, () => { s.end('bye') })
  s.on('data', (d: Buffer) => console.log('got', String(d)))
  s.on('close', () => { console.log('closed'); srv.close(() => console.log('srv closed')) })
})
