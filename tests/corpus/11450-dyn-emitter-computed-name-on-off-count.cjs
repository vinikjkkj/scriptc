'use strict';
// Untyped receivers with a COMPUTED event name (a parameter): on, off,
// removeListener and listenerCount dispatch by the runtime name over the
// program's literal names.
const EventEmitter = require('events');
class Conn extends EventEmitter {}
function attach(src, name) {
  src.on(name, function (a) { console.log('got', name, a); });
  console.log('count', name, src.listenerCount(name));
}
function detach(src, name, fn) { src.removeListener(name, fn); }
const c = new Conn();
attach(c, 'ping');
c.emit('ping', 1);
attach(c, 'ping');
c.emit('ping', 2);
const f = function () { console.log('f'); };
c.on('x', f);
detach(c, 'x', f);
console.log('after x', c.listenerCount('x'));
c.on('y', f);
function off2(src, name, fn) { src.off(name, fn); }
off2(c, 'y', f);
console.log('after y', c.listenerCount('y'));
