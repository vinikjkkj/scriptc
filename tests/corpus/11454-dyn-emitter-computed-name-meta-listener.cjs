'use strict';
// A computed name that IS a meta event: a name-only newListener listener
// registered through a parameter sees each later registration.
const EventEmitter = require('events');
class Conn extends EventEmitter {}
function watch(src, name) {
  src.on(name, function (ev) { console.log('meta', ev); });
}
const c = new Conn();
watch(c, 'newListener');
c.on('x', function () {});
c.on('y', function () {});
console.log('count', c.listenerCount('newListener'));
