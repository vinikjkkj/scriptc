// A second connect() while the first is still connecting: EALREADY on the
// socket, the first connect's callback never runs, and the socket closes.
import { Socket, createServer } from 'net'
const srv = createServer((c) => { c.on('error', () => {}); c.on('data', (d: Buffer) => c.end('echo:' + d)) })
srv.listen(49913, '127.0.0.1', () => {
  const C = new Socket()
  C.on('error', (e: NodeJS.ErrnoException) => console.log('C error', e.code))
  C.on('close', () => { console.log('C close'); srv.close(() => console.log('srv closed')) })
  C.connect(49913, '127.0.0.1', () => console.log('FIRST callback must not run'))
  C.connect(49913, '127.0.0.1', () => console.log('SECOND callback must not run'))
})
