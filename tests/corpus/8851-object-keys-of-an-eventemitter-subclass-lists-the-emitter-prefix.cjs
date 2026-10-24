'use strict';
// Object.keys of an EventEmitter subclass instance: Node lists _events, _eventsCount and
// _maxListeners ahead of the program's own fields, base class fields before derived ones.
const EventEmitter = require('events').EventEmitter;
class Base extends EventEmitter {
  constructor(tag) { super(); this.tag = tag; this.count = 0; }
}
class Derived extends Base {
  constructor(tag) { super(tag); this.extra = true; }
  method() { return this.tag; }
}
class Plain { constructor() { this.a = 1; this.b = 2; } }
const keysOf = (x) => Object.keys(x);
const b = new Base('b');
b.on('x', () => {});
const d = new Derived('d');
console.log(keysOf(b));
console.log(keysOf(d), d.method());
console.log(keysOf(new Plain()));
console.log(Object.keys(b).length, Object.keys(d).includes('extra'), Object.keys(d).indexOf('tag'));
