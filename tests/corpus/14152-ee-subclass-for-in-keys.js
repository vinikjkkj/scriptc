// for-in over an EventEmitter subclass instance visits the instance's own keys (the
// emitter's three, then the subclass's), then EventEmitter.prototype's enumerable keys,
// in Node's order. Object.keys does not walk the prototype; for-in does.
import { EventEmitter } from 'node:events';
class Command extends EventEmitter {
  constructor() {
    super();
    this.next = null;
  }
}
const c = new Command();
const keys = [];
for (const k in c) keys.push(k);
console.log(keys.join(','));
