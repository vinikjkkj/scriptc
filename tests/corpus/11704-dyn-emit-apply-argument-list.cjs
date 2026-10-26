'use strict';
// emit applied to a runtime argument list: the first element is the event
// name, the rest reach each listener; emit answers whether it had listeners.
const EventEmitter = require('events');
class Conn extends EventEmitter {}
const c = new Conn();
c.on('ping', function (x) { console.log('p0', x); });
c.on('ping', function (x, y) { console.log('p1', x, y); });
c.on('ping', function () { console.log('pa', arguments.length, arguments[2]); });
const args = ['ping', 1, 'two', 3];
console.log('had', c.emit.apply(c, args));
console.log('none', c.emit.apply(c, ['pong', 5]));
console.log('empty', c.emit.apply(c, ['ping']));
