'use strict';
// A newListener / removeListener listener that declares only the event name registers through
// the dynamic-listener path; the `arguments` it mentions belongs to a nested function (mysql2's
// inheritEvents builds a forwarding function inside its newListener listener), not to the listener.
const EventEmitter = require('events').EventEmitter;
const forwarded = [];
class W extends EventEmitter {
  constructor() {
    super();
    this.on('newListener', (eventName) => {
      const fwd = function () { return [].slice.call(arguments).length; };
      forwarded.push('add:' + eventName + ':' + fwd(1, 2, 3));
    });
    this.on('removeListener', (eventName) => {
      const count = function () { return arguments.length; };
      forwarded.push('rm:' + eventName + ':' + count());
    });
  }
}
const w = new W();
const f = () => {};
w.on('data', f);
w.removeListener('data', f);
console.log(forwarded);
