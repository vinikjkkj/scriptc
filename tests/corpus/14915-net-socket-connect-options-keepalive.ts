// The options form connect({ port, host }, listener), the keep-alive and
// no-delay setters (which answer the socket), and ref()/unref() answering it.
import { Socket, createServer } from 'net'
const srv = createServer((c) => { c.on('error', () => {}); c.on('data', (d: Buffer) => c.end('echo:' + d)) })
srv.listen(17915, '127.0.0.1', () => {
  const K = new Socket()
  console.log('K keepalive chains', K.setKeepAlive(true, 500) === K, 'nodelay chains', K.setNoDelay(true) === K)
  console.log('K ref chains', K.ref() === K, 'unref chains', K.unref() === K)
  K.on('data', (d: Buffer) => console.log('K data', String(d)))
  K.on('close', () => { console.log('K close'); srv.close(() => console.log('srv closed')) })
  K.connect({ port: 17915, host: '127.0.0.1' }, () => { console.log('K options cb'); K.end('k') })
})
