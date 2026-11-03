const EventEmitter = require('events').EventEmitter;
// stateName(): `this[i] === state` over the enumerable fields. A field that holds the same function as `next` is
// found by name; the prototype method itself is not enumerable, so `start` is never a match.
class Command extends EventEmitter {
  constructor() {
    super();
    this.next = null;
  }
  stateName() {
    const state = this.next;
    for (const i in this) {
      if (this[i] === state && i !== 'next') {
        return i;
      }
    }
    return 'unknown name';
  }
  prime() {
    this.next = this.start;
    this.alias = this.start;
    this.other = this.stop;
    return this.stateName();
  }
}
class Query extends Command {
  start(p, c) {
    return null;
  }
}
class Quit extends Command {
  start() {
    return null;
  }
  stop() {
    return 1;
  }
}
const q = new Query();
const u = new Quit();
console.log(q.prime(), u.prime());
console.log(Object.keys(q).join(','), Object.keys(u).join(','));
u.next = u.stop;
console.log(u.stateName());
console.log(q.alias === Query.prototype.start, u.alias === Quit.prototype.start, q.alias === u.alias);
