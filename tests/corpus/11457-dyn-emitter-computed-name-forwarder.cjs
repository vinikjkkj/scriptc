'use strict';
// A forwarder that registers on computed-name events of an untyped source
// and hands each payload to a relay callback.
const EventEmitter = require('events');
function forward(source, events, relay) {
  for (const name of events) {
    source.on(name, function (a) { relay(name, a); });
  }
}
const src = new EventEmitter();
const dst = new EventEmitter();
dst.on('relay', function (n, a) { console.log('relay', n, a); });
forward(src, ['ping', 'data'], function (n, a) { dst.emit('relay', n, a); });
src.emit('ping', 42);
src.emit('data', 'x');
console.log('count', src.listenerCount('ping'), dst.listenerCount('relay'));
