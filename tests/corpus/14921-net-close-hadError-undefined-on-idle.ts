// The close listener's hadError: undefined when an unconnected socket closes
// (a write that fails before connect), false when a
// connected socket closes after its peer ends.
import { Socket, createServer } from 'net'
const srv = createServer((c) => { c.on('error', () => {}); c.on('data', (d: Buffer) => c.end('echo:' + d)) })
srv.listen(17921, '127.0.0.1', () => {
  const W = new Socket()
  W.on('error', (e: NodeJS.ErrnoException) => console.log('W error', e.code, e.message))
  W.on('close', (h: boolean) => console.log('W close', h, typeof h))
  W.write('x')
  const C = new Socket()
  C.on('close', (h: boolean) => { console.log('C close', h, typeof h); srv.close(() => console.log('srv closed')) })
  C.connect(17921, '127.0.0.1', () => { C.write('hi') })
  C.on('data', (d: Buffer) => console.log('C data', String(d)))
})
