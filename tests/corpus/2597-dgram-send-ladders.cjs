// dgram createSocket's options.signal contract: the AbortSignal type
// validation answers Node's exact error. (Socket.send over dynamic
// arguments has no real operation behind its validation ladder, so it is
// refused at compile time: see
// tests/diagnostics/js-dgram-send-over-dynamic-arguments.cjs.)
'use strict';
const dgram = require('dgram');
const sock = dgram.createSocket('udp4');
const show = (fn) => { try { fn(); console.log('ok'); } catch (e) { console.log(`${e.name}|${e.code}|${e.message}`); } };
show(() => { dgram.createSocket({ type: 'udp4', signal: {} }); });
sock.close();
