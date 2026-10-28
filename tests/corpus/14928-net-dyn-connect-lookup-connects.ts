// A dyn connect with a lookup option: lookup(host, { hints, all: true }, cb)
// runs for a host name (not for an IP literal), and the array answer dials.
import * as net from 'net'
const srv = net.createServer((c) => { c.on('error', () => {}); c.end('bye') })
const d: any = new net.Socket()
d.on('connect', () => { console.log('connect'); d.destroy() })
d.on('close', (h: boolean) => { console.log('close', h); srv.close(() => console.log('srv closed')) })
const lookup = (host: any, opts: any, cb: any) => {
  console.log('lookup', host, JSON.stringify(opts))
  cb(null, [{ address: '127.0.0.1', family: 4 }])
}
srv.listen(17928, '127.0.0.1', () => {
  d.connect({ port: 17928, host: 'example.invalid', lookup })
})
