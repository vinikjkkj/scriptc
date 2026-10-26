'use strict';
// emit with a LITERAL name on an untyped receiver: the emit reaches the
// typed listeners of the event, and returns Node's boolean.
const EventEmitter = require('events');
class Conn extends EventEmitter {}
function fire(src, n) { return src.emit('msg', n); }
function tick(src) { return src.emit('tick'); }
const c = new Conn();
c.on('msg', (x) => console.log('typed', x));
console.log('r1', fire(c, 9));
c.on('tick', () => console.log('tick!'));
console.log('r2', tick(c));
console.log('r3', tick(new Conn()));
