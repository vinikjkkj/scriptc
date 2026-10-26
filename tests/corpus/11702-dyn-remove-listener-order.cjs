'use strict';
// removeListener fires AFTER the removal: the count it reads is already
// lower, and the listener it is handed is the one that was removed.
const EventEmitter = require('events');
const c = new EventEmitter();
const a = function () { console.log('a'); };
const b = function () { console.log('b'); };
c.on('evt', a);
c.on('evt', b);
c.on('removeListener', function (name, fn) {
  console.log('removed', name, fn === a || fn === b ? 'known' : 'other', c.listenerCount(name));
});
c.removeListener('evt', a);
c.emit('evt');
c.removeAllListeners('evt');
console.log('done', c.listenerCount('evt'));
