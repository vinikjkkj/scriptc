const dc = require('node:diagnostics_channel');
const tc = dc.tracingChannel('t6');
const ch = dc.channel('c6');
function id(x) { return x; }
console.log('identity', id(tc) === tc, id(ch) === ch, dc.channel('c6') === ch);
const holder = { tc, ch: dc.channel('c6') };
console.log('holder', holder.ch === ch, holder.tc === tc);
const maybe = Math.random() < 2 ? dc.tracingChannel('t6') : undefined;
if (maybe) console.log('maybe has', maybe.hasSubscribers);
function sub(c, f) { c.start.subscribe(f); c.end.subscribe((m) => console.log('end-ev', m.tag)); }
function unsub(c, f) { return c.start.unsubscribe(f); }
function has(c) { return c.hasSubscribers; }
function pubAny(c, m) { c.publish(m); }
function trCb(c) {
  return c.traceCallback((x, cb) => cb(null, x * 2), 1, { tag: 'cb' }, null, 21, (e, v) => console.log('cb', e, v));
}
function trPromise(c) {
  return c.tracePromise((x) => Promise.resolve(x + 1), { tag: 'pr' }, null, 4).then((v) => console.log('promise', v));
}
function trSync(c) {
  return c.traceSync((x) => x - 1, { tag: 'sy' }, null, 10);
}
const seen = (m) => console.log('start-ev', m.tag);
console.log('before has', has(tc), has(ch));
trSync(tc);
sub(tc, seen);
console.log('after has', has(tc));
console.log('sync result', trSync(tc));
trCb(tc);
trPromise(tc).then(() => console.log('done promise'));
console.log('unsub', unsub(tc, seen));
trSync(tc);
dc.channel('pubtest').subscribe((m) => console.log('pub', m));
pubAny(dc.channel('pubtest'), 'hello');
pubAny(holder.ch, 'via holder');
console.log('ch has', has(ch));
