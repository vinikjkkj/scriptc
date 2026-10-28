// With every handle unref'd (the server, the accepted socket, the client),
// nothing keeps the loop alive: the process exits right after 'connected'.
import { Socket, createServer } from 'net'
const srv = createServer((c) => { c.unref(); c.on('error', () => {}) })
srv.listen(0, '127.0.0.1', () => {
  const port = srv.address().port
  const s = new Socket()
  s.connect(port, '127.0.0.1', () => { console.log('connected'); s.unref() })
  s.on('close', () => console.log('client close'))
  srv.unref()
  console.log('end of main')
})
