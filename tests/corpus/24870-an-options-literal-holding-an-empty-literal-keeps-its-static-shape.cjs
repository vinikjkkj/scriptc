// An options literal that merely CONTAINS `{}` (here `signal: {}`) is not a placeholder slot: nothing assigns it a value, so it keeps
// its static shape and createSocket's option check still sees the member. (corpus 2597 is the larger ladder over the same shape.)
const dgram = require('node:dgram');
function show(f) { try { f(); console.log('ok'); } catch (e) { console.log(e.code, e.message); } }
show(() => { dgram.createSocket({ type: 'udp4', signal: {} }); });
const slot = { e: {} };
slot.e = new Error('boom');
console.log(slot.e instanceof Error, slot.e.message);
