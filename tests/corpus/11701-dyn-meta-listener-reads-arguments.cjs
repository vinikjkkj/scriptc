'use strict';
// A checked-dynamic meta listener that reads `arguments`: it sees the event
// name and the listener function, and nothing else.
const EventEmitter = require('events');
const c = new EventEmitter();
c.on('newListener', function () {
  console.log('args', arguments.length, arguments[0], typeof arguments[1]);
});
c.on('removeListener', function () {
  console.log('gone', arguments.length, arguments[0], typeof arguments[1]);
});
function tick() { console.log('tick'); }
c.on('tick', tick);
c.removeListener('tick', tick);
c.once('tock', function () { console.log('tock'); });
c.emit('tock');
console.log('n', c.listenerCount('tock'));
