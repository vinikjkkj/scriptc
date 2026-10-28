// A host name that does not resolve: the failure is Node's getaddrinfo
// ENOTFOUND with errno, syscall and hostname.
import * as net from 'net'
const d: any = new net.Socket()
d.on('error', (e: any) => console.log('error', e.name, e.code, e.message, e.errno, e.syscall, e.hostname))
d.on('close', (h: boolean) => console.log('close', h))
d.connect(17927, 'example.invalid')
