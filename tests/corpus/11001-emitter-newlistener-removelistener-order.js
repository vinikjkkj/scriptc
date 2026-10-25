'use strict';
// The meta events of a subclass of EventEmitter: 'newListener' fires BEFORE
// the listener is added (listenerCount is still the old count), and
// 'removeListener' fires AFTER it is removed (listenerCount is already the
// new count). Both carry the event name first.
const EventEmitter = require('events').EventEmitter;
class Forwarder extends EventEmitter {
  constructor() {
    super();
    const log = [];
    this.log = log;
    this.on('newListener', (name) => {
      log.push('new:' + name + ':' + this.listenerCount(name));
    }).on('removeListener', (name) => {
      log.push('remove:' + name + ':' + this.listenerCount(name));
    });
  }
}
const f = new Forwarder();
const h1 = () => {};
const h2 = () => {};
f.on('ping', h1);
f.on('ping', h2);
console.log(f.listenerCount('ping'));
f.off('ping', h1);
f.removeListener('ping', h2);
console.log(f.listenerCount('ping'));
console.log(f.log.join(' | '));
