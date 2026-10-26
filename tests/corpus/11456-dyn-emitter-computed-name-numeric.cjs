'use strict';
// A numeric computed name is the same key as its string.
const EventEmitter = require('events');
function attach(src, name) {
  src.on(name, function (a) { console.log('num', a); });
  return src.listenerCount(String(name));
}
const c = new EventEmitter();
console.log('n1', attach(c, 5));
c.emit('5', 'five');
console.log("n2", c.listenerCount(String(5)));
