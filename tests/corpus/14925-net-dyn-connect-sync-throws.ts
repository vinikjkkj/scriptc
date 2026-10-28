// Node's synchronous connect() errors on a dyn socket: an invalid port
// (RangeError), a missing argument, a non-string host. A socket whose port or
// host was checked has a handle, so destroy() then reports hadError false; an
// argument-shape error leaves no handle and reports undefined. The unconnected
// sockets close first, in call order; the ones with a handle close last, in
// reverse order.
import * as net from 'net'
const d1: any = new net.Socket()
d1.on('close', (h: boolean) => console.log('nan close', h))
try { d1.connect(NaN, '127.0.0.1') } catch (e: any) { console.log('nan throw', e.name, e.code, e.message); d1.destroy() }
const d2: any = new net.Socket()
d2.on('close', (h: boolean) => console.log('negative close', h))
try { d2.connect({ port: -1, host: '127.0.0.1' }) } catch (e: any) { console.log('negative throw', e.name, e.code, e.message); d2.destroy() }
const d3: any = new net.Socket()
d3.on('close', (h: boolean) => console.log('missing close', h))
try { d3.connect() } catch (e: any) { console.log('missing throw', e.name, e.code, e.message); d3.destroy() }
const d4: any = new net.Socket()
d4.on('close', (h: boolean) => console.log('too-big close', h))
try { d4.connect(65536, '127.0.0.1') } catch (e: any) { console.log('too-big throw', e.name, e.code, e.message); d4.destroy() }
const d5: any = new net.Socket()
d5.on('close', (h: boolean) => console.log('host-type close', h))
try { d5.connect({ port: 17925, host: 5 }) } catch (e: any) { console.log('host-type throw', e.name, e.code, e.message); d5.destroy() }
const d6: any = new net.Socket()
d6.on('close', (h: boolean) => console.log('no-port close', h))
try { d6.connect(undefined, '127.0.0.1') } catch (e: any) { console.log('no-port throw', e.name, e.code, e.message); d6.destroy() }
