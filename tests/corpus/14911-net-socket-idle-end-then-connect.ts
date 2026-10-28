// A bare end() on an unconnected socket finishes the write half and nothing
// else; a later connect() revives it, and the write half is open again.
import { Socket, createServer } from 'net'
const srv = createServer((c) => { c.on('error', () => {}); c.on('data', (d: Buffer) => c.end('echo:' + d)) })
srv.listen(17911, '127.0.0.1', () => {
  const E = new Socket()
  let connected = false
  E.on('finish', () => {
    console.log('E finish')
    console.log('E later writable', E.writable)
    if (!connected) {
      connected = true
      E.connect(17911, '127.0.0.1', () => { console.log('E connected writable', E.writable); E.write('hi') })
    }
  })
  E.on('error', (e: NodeJS.ErrnoException) => console.log('E error', e.code))
  E.on('data', (d: Buffer) => console.log('E data', String(d)))
  E.on('close', () => { console.log('E close'); srv.close(() => console.log('srv closed')) })
  E.end()
  console.log('E after end writable', E.writable, 'destroyed', E.destroyed)
})
