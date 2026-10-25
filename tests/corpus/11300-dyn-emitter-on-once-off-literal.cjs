'use strict';
// Untyped receivers that hold an EventEmitter subclass instance: on, once,
// off and removeListener with LITERAL event names, reached through a
// parameter whose type is implicit any.
const EventEmitter = require('events');
class Conn extends EventEmitter {}
function attach(src) {
  src.on('ping', function (a) { console.log('got ping', a); });
  src.once('ping', function (a) { console.log('once ping', a); });
  console.log('count', src.listenerCount('ping'));
}
function detach(src, fn) { src.removeListener('x', fn); src.off('y', fn); }
const c = new Conn();
attach(c);
c.emit('ping', 1);
c.emit('ping', 2);
const f = function () { console.log('f'); };
c.on('x', f);
detach(c, f);
console.log('after x', c.listenerCount('x'));
c.on('y', f);
detach(c, f);
console.log('after y', c.listenerCount('y'));
