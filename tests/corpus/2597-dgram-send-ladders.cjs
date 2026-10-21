// dgram.Socket.send's argument-validation ladder: Node's signature
// shuffle over dyn arguments — the offset/length slice's type and bounds
// contracts (ERR_BUFFER_OUT_OF_BOUNDS, DataViews and subarrays included),
// the buffer-list per-element contract with the LIST as the Received
// tail, the unconnected port ladder (ERR_SOCKET_BAD_PORT with the
// specific-type tail and Node's trailing period), the address string
// contract (null/undefined-only gate — a falsy 0 still throws), and the
// connected-state ERR_SOCKET_DGRAM_IS_CONNECTED arms. createSocket's
// options.signal validates the AbortSignal contract the same way.
'use strict';
const dgram = require('dgram');
const sock = dgram.createSocket('udp4');
const buf = Buffer.from('test');
const host = '127.0.0.1';
const show = (fn) => { try { fn(); console.log('ok'); } catch (e) { console.log(`${e.name}|${e.code}|${e.message}`); } };
show(() => { dgram.createSocket({ type: 'udp4', signal: {} }); });
show(() => sock.send());
show(() => sock.send(buf, 1, 1, -1, host));
show(() => sock.send(buf, 1, 1, 0, host));
show(() => sock.send(buf, 1, 1, 65536, host));
show(() => sock.send(23, 12345, host));
show(() => sock.send([buf, 23], 12345, host));
show(() => sock.send(buf, 6, 0));
show(() => sock.send('hello', 6, 0, 12345, host));
show(() => sock.send('hello', 0, 6, 12345, host));
show(() => sock.send('hello', 3, 4, 12345, host));
show(() => sock.send(new Uint8Array([1, 2, 3, 4, 5]).subarray(0, 5), 6, 0, 12345, host));
show(() => sock.send(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).subarray(2, 7), 0, 6, 12345, host));
show(() => sock.send(new DataView(new ArrayBuffer(7), 1, 5), 3, 4, 12345, host));
sock.connect(12345, () => {
  show(() => sock.send(buf, 1, 1, -1, host));
  show(() => sock.send(buf, 1234, '127.0.0.1', () => {}));
  show(() => sock.send('hello', 6, 0));
  show(() => sock.send('hello', 0, 6));
  show(() => sock.send(23, 12345, host));
  sock.close();
});
