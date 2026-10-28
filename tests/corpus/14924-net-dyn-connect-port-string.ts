// A dyn socket's connect() takes a numeric string as the port (Node's
// normalizeArgs: Number(text) is a port), and the 'connect' listener runs.
import * as net from 'net'
const srv = net.createServer((c) => { c.on('error', () => {}); c.end('bye') })
srv.listen(17924, '127.0.0.1')
const d: any = new net.Socket()
d.on('connect', () => { console.log('connect'); d.destroy() })
d.on('close', (h: boolean) => { console.log('close', h); srv.close(() => console.log('srv closed')) })
d.connect('17924', '127.0.0.1')
