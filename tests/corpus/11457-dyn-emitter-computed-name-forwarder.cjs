'use strict';
// A forwarder that re-emits a computed-name event on a second emitter.
const EventEmitter = require('events');
function forward(source, target, events) {
  for (const name of events) {
    source.on(name, function (a) { target.emit('relay', name, a); });
  }
}
const src = new EventEmitter();
const dst = new EventEmitter();
dst.on('relay', function (n, a) { console.log('relay', n, a); });
forward(src, dst, ['ping', 'data']);
src.emit('ping', 42);
src.emit('data', 'x');
console.log('count', src.listenerCount('ping'), dst.listenerCount('relay'));
