// new net.Socket() written before any connect: Node destroys it with
// ERR_SOCKET_CLOSED (writable false at once, destroyed and 'error' when the
// error is delivered); a second write while that error is pending is silent.
import { Socket, createServer } from 'net'
const srv = createServer((c) => { c.on('error', () => {}) })
srv.listen(17910, '127.0.0.1', () => {
  const W = new Socket()
  W.on('error', (e: NodeJS.ErrnoException) => console.log('W error', e.code, e.message, 'destroyed', W.destroyed))
  W.on('close', () => { console.log('W close'); srv.close(() => console.log('srv closed')) })
  console.log('W fresh writable', W.writable, 'destroyed', W.destroyed)
  W.write('x')
  console.log('W write sync writable', W.writable, 'destroyed', W.destroyed)
  W.write('y')
})
