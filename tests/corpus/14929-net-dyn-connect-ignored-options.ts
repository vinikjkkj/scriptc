// The options Node ignores on connect() (timeout, family, hints,
// autoSelectFamily, unknown keys) do not change the connection.
import * as net from 'net'
const srv = net.createServer((c) => { c.on('error', () => {}); c.end('bye') })
srv.listen(17929, '127.0.0.1')
const opts: any = { port: 17929, host: '127.0.0.1', timeout: 1000, family: 4, hints: 0, autoSelectFamily: true, unknownKey: 1 }
const d: any = new net.Socket()
d.on('connect', () => { console.log('connect'); d.destroy() })
d.on('close', (h: boolean) => { console.log('close', h); srv.close(() => console.log('srv closed')) })
d.connect(opts)
