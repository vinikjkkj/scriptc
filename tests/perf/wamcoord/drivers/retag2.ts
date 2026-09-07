// How narrow is the gap? Four sources into the SAME structural arm.
declare const ch: RTCDataChannel        // a handle IR kind
declare const sock: { close(): void }   // the arm itself
class Closer { close(): void {} }       // a nominal CLASS with the member
interface Iface { close(): void }
declare const iface: Iface              // a nominal INTERFACE with the member

function q(c: { close(): void } | null | undefined): void { c?.close() }

q(sock)      // control
q(new Closer())
q(iface)
q(ch)
console.log('done')
