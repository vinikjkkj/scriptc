// Minimal loopback echo server: one line in, one line out. The peer for the
// round-trip microbenchmark, so the client side is the only variable.
import { createServer } from 'node:net'
const server = createServer((sock) => {
  sock.setNoDelay(true)
  let buf = ''
  sock.on('data', (c) => {
    buf += c.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      sock.write(line + '\n')
    }
  })
  sock.on('error', () => {})
})
server.listen(Number(process.argv[2]), '127.0.0.1', () => {
  process.stdout.write('READY\n')
})
