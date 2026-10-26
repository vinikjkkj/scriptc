'use strict';
// A checked-dynamic 'newListener' / 'removeListener' listener with two
// parameters: Node passes (eventName, listener). Each listener is seen as a
// function, and the add fires before the add, the removal after it.
const EventEmitter = require('events');
class Conn extends EventEmitter {}
const c = new Conn();
c.on('newListener', function (name, fn) {
  console.log('new', name, typeof fn, c.listenerCount(name));
});
c.on('removeListener', function (name, fn) {
  console.log('removed', name, typeof fn, c.listenerCount(name));
});
const onPing = function (x) { console.log('ping', x); };
c.on('ping', onPing);
c.emit('ping', 1);
c.off('ping', onPing);
console.log('after', c.listenerCount('ping'), c.emit('ping', 2));
