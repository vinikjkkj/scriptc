'use strict';
// A computed name on a receiver that is not an emitter: Node's TypeError.
const EventEmitter = require('events');
function attach(src, name) { src.on(name, function () {}); }
try {
  attach({ on: null }, 'ping');
} catch (e) {
  console.log(e instanceof TypeError, e.message);
}
attach(new EventEmitter(), 'ok');
console.log('done');
