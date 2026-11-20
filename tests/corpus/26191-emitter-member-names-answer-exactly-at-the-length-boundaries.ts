// The dyn view of an EventEmitter subclass answers its fifteen member names by name and length: every member, and names that differ from a
// member in one letter, in the first letter, in length by one, empty, one letter, and past the longest member, must read exactly as Node's.
import { EventEmitter } from 'events';

class Hub extends EventEmitter {
  tag = 'hub';
}
const h = new Hub();
const d: any = h;
const members = ['on', 'once', 'off', 'emit', 'addListener', 'removeListener', 'removeAllListeners', 'prependListener',
  'prependOnceListener', 'listenerCount', 'listeners', 'rawListeners', 'eventNames', 'setMaxListeners', 'getMaxListeners'];
const near: string[] = [];
for (const m of members) {
  near.push(m + 'x'); // longer by one
  near.push(m.slice(0, -1)); // shorter by one
  near.push('X' + m.slice(1)); // first letter differs
  near.push(m.slice(0, -1) + 'X'); // last letter differs
}
near.push('', 'o', 'xx', 'prependOnceListenet', 'prependOnceListenerr', 'removeAllListenersXXXXXXXX');
let seen = 0;
for (const k of members.concat(near)) {
  const t = typeof d[k];
  if (t !== 'undefined') seen++;
  console.log(JSON.stringify(k), t, k in d);
}
console.log('seen', seen, d.once === d.once, d.on === d.addListener, d.emit.call(h, 'nope'), d.tag);
