'use strict';
// A once listener reached through emit.apply fires once; an 'error' with no
// listener throws its payload, catchable like Node's unhandled-'error'.
const EventEmitter = require('events');
const c = new EventEmitter();
c.once('data', function (a, b) { console.log('once', a, b); });
console.log(c.emit.apply(c, ['data', 'x', 'y']), c.emit.apply(c, ['data', 'z']));
console.log('left', c.listenerCount('data'));
try {
  c.emit.apply(c, ['error', new Error('boom')]);
} catch (e) {
  console.log('caught', e.message);
}
