'use strict';
// once through a computed name fires once; the later emit is a no-op.
const EventEmitter = require('events');
class Conn extends EventEmitter {}
function listenOnce(src, name) {
  src.once(name, function (a) { console.log('once', name, a); });
  console.log('n', src.listenerCount(name));
}
const c = new Conn();
listenOnce(c, 'data');
c.emit('data', 1);
console.log('after', c.listenerCount('data'), c.emit('data', 3));
