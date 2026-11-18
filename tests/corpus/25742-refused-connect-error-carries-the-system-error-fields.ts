// The refused-connect error is a system error: name Error, message 'connect ECONNREFUSED 127.0.0.1:<port>', code,
// a negative errno, syscall 'connect', address and port; the errno is the libuv one (-111 on Linux, -4078 on Windows).
import * as net from 'net'

const probe = net.createServer()
probe.listen(0, '127.0.0.1', () => {
  const port = (probe.address() as any).port
  probe.close(() => {
    const s = net.connect(port, '127.0.0.1')
    s.on('error', (e: NodeJS.ErrnoException & { address?: string; port?: number }) => {
      console.log(e instanceof Error, e.name, e.message === `connect ECONNREFUSED 127.0.0.1:${port}`)
      console.log(e.code, typeof e.errno, e.errno !== undefined && e.errno < 0, e.syscall, e.address, e.port === port)
      console.log(Object.keys(e).sort().join(','))
    })
  })
})
