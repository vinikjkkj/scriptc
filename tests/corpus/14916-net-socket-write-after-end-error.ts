// end() with no data finishes the write half; a write after it is the
// ERR_STREAM_WRITE_AFTER_END error, delivered after 'finish'.
import { Socket, createServer } from 'net'
const srv = createServer((c) => { c.on('error', () => {}); c.on('data', (d: Buffer) => c.end('echo:' + d)) })
srv.listen(49916, '127.0.0.1', () => {
  const G = new Socket()
  G.on('finish', () => console.log('G finish'))
  G.on('error', (e: NodeJS.ErrnoException) => console.log('G error', e.code, e.message))
  G.on('close', () => { console.log('G close'); srv.close(() => console.log('srv closed')) })
  G.end()
  G.write('after end')
})
