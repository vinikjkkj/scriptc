// destroy() on an unconnected socket emits 'close' with no error; the same
// object connects afterwards and the exchange runs on the new connection.
import { Socket, createServer } from 'net'
const srv = createServer((c) => { c.on('error', () => {}); c.on('data', (d: Buffer) => c.end('echo:' + d)) })
srv.listen(49912, '127.0.0.1', () => {
  const D = new Socket()
  D.on('error', (e: NodeJS.ErrnoException) => console.log('D error', e.code))
  D.on('close', () => console.log('D close'))
  D.on('data', (d: Buffer) => console.log('D data', String(d)))
  D.destroy()
  console.log('D destroyed sync', D.destroyed, 'writable', D.writable)
  setTimeout(() => {
    D.connect(49912, '127.0.0.1', () => { console.log('D reconnected destroyed', D.destroyed); D.write('again') })
    D.on('close', () => { console.log('D final close'); srv.close(() => console.log('srv closed')) })
  }, 50)
})
