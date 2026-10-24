// newListener / removeListener listeners that declare only the event name (mysql2's inheritEvents) have an untyped parameter.
'use strict';
const EventEmitter = require('events').EventEmitter;
const seen = [];
class W extends EventEmitter {
  constructor() {
    super();
    this.on('newListener', (eventName) => { seen.push('add:' + eventName); });
    this.on('removeListener', (eventName) => { seen.push('rm:' + eventName); });
  }
}
const w = new W();
const f = () => {};
w.on('error', f);
w.once('data', () => {});
w.removeListener('error', f);
console.log(seen);
