'use strict';
// An EventEmitter subclass instance held in an untyped slot (mysql2's PromiseConnection.connection,
// a Pool's connections) answers the members the program declared: fields read, methods called,
// getters run, subclass overrides win. Enumerating such an instance is not modeled.
const EventEmitter = require('events').EventEmitter;
class Base extends EventEmitter {
  constructor(tag) { super(); this.tag = tag; this.count = 0; }
  query(sql) { this.count++; return this.tag + ':' + sql + '#' + this.count; }
  get label() { return 'L-' + this.tag; }
  who() { return 'base'; }
}
class Derived extends Base {
  who() { return 'derived'; }
  extra(a, b) { return a + b + this.count; }
}
class Holder {
  constructor(c) { this.c = c; }
  run(sql) { return this.c.query(sql); }
  info() { return [this.c.tag, this.c.label, this.c.who(), this.c.count]; }
}
const h = new Holder(new Base('b'));
console.log(h.run('a'), h.run('b'), h.info());
const d = new Holder(new Derived('d'));
console.log(d.run('x'), d.info(), d.c.extra(1, 2));
function viaAny(x) { return [x.tag, x.who(), typeof x.query, x.query('z')]; }
console.log(viaAny(new Derived('v')), viaAny(new Base('w')));
