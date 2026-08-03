// A real `ws` echo server (public API). Prints the bound port to stdout,
// echoes every message back, and exits after the client disconnects or a
// 10s timeout — so the C interop client can validate its handshake request
// is accepted by a reference server and its masked frames decode correctly.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { WebSocketServer } = require('ws')

const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
const deadline = setTimeout(() => process.exit(2), 10000)

wss.on('listening', () => {
  console.log(`PORT ${wss.address().port}`)
})

wss.on('connection', (ws) => {
  ws.on('message', (data, isBinary) => {
    ws.send(data, { binary: isBinary })
  })
  ws.on('close', () => {
    clearTimeout(deadline)
    wss.close(() => process.exit(0))
  })
})
