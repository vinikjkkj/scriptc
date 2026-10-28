// The EALREADY system error carries errno, code, syscall, address and port,
// as Node sets them. ERR_SOCKET_CLOSED is a plain coded Error: code only.
import { Socket, createServer } from 'net'
const srv = createServer((c) => { c.on('error', () => {}); c.on('data', (d: Buffer) => c.end('echo:' + d)) })
srv.listen(0, '127.0.0.1', () => {
  const port = srv.address().port
  const W = new Socket()
  W.on('error', (e: NodeJS.ErrnoException) => console.log('W error', e.code, e.errno, e.syscall, (e as any).address, typeof (e as any).port))
  W.write('x')
  const C = new Socket()
  C.on('error', (e: NodeJS.ErrnoException) => console.log('C error', e.code, e.errno, e.syscall, (e as any).address, typeof (e as any).port))
  C.on('close', (h: boolean) => { console.log('C close', h); srv.close(() => console.log('srv closed')) })
  C.connect(port, '127.0.0.1', () => console.log('FIRST must not run'))
  C.connect(port, '127.0.0.1', () => console.log('SECOND must not run'))
})
