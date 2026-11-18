// A TCP connect to a port nobody listens on: 'error' (ECONNREFUSED) first, then 'close' with hadError true;
// no 'connect' event, and the socket ends destroyed.
import * as net from 'net'

const probe = net.createServer()
probe.listen(0, '127.0.0.1', () => {
  const port = (probe.address() as any).port
  probe.close(() => {
    const s = net.connect(port, '127.0.0.1')
    const order: string[] = []
    s.on('connect', () => order.push('connect'))
    s.on('error', (e: NodeJS.ErrnoException) => order.push('error:' + e.code))
    s.on('close', (hadError: boolean) => {
      order.push('close:' + hadError)
      console.log(order.join(' '), s.destroyed)
    })
  })
})
