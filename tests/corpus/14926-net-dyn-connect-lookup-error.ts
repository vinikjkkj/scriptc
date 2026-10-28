// A lookup that answers with an error: the socket fails with that same Error
// object (its message is the error's, and it carries no code).
import * as net from 'net'
const d: any = new net.Socket()
d.on('error', (e: any) => console.log('error', e.name, e.code, e.message))
d.on('close', (h: boolean) => console.log('close', h))
const lookup = (host: any, opts: any, cb: any) => {
  console.log('lookup', host)
  cb(new Error('nope'))
}
d.connect({ port: 17926, host: 'example.invalid', lookup })
