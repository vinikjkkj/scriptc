const dc = require('node:diagnostics_channel');
const tc = dc.tracingChannel('t6');
const ch = dc.channel('c6');
function id(x) { return x; }
console.log('identity', id(tc) === tc, id(ch) === ch, dc.channel('c6') === ch);
const holder = { tc, ch: dc.channel('c6') };
console.log('holder', holder.ch === ch, holder.tc === tc);
const maybe = Math.random() < 2 ? dc.tracingChannel('t6') : undefined;
if (maybe) console.log('maybe has', maybe.hasSubscribers);
const ch2 = dc.channel('c6-id');
const wrap = { inner: ch2, list: [ch2] };
console.log('object field', wrap.inner === ch2, wrap.list[0] === ch2, id(wrap.inner) === ch2);
