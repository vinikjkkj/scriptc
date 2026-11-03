// `this[k]` over the EventEmitter.prototype member names a for-in yields: the functions are identity-stable
// values (one function per member, `on` is `addListener`, `off` is `removeListener`), the same through two
// instances, and callable through the read.
import { EventEmitter } from 'events';

class Hub extends EventEmitter {
  tag: string;
  constructor(tag: string) {
    super();
    this.tag = tag;
  }
  members(): any {
    const out: any = {};
    for (const k in this) {
      // @ts-ignore
      const v = this[k];
      out[k] = v;
    }
    return out;
  }
  fnNames(): string {
    const out: string[] = [];
    for (const k in this) {
      // @ts-ignore
      if (typeof this[k] === 'function') out.push(k);
    }
    return out.join(',');
  }
}

const a = new Hub('a');
const b = new Hub('b');
const names: string[] = process.argv.length > 99 ? ['zz'] : ['pub'];
Object.defineProperty(a, names[0], { value: 7, enumerable: true, writable: true, configurable: true });
Object.defineProperty(b, names[0], { value: 8, enumerable: true, writable: true, configurable: true });

const ma = a.members();
const mb = b.members();
console.log(a.fnNames());
const fns = ['setMaxListeners', 'getMaxListeners', 'emit', 'addListener', 'on', 'prependListener', 'once',
  'prependOnceListener', 'removeListener', 'off', 'removeAllListeners', 'listeners', 'rawListeners', 'listenerCount',
  'eventNames'];
for (const m of fns) {
  console.log(m, ma[m] === mb[m], ma[m] === a.members()[m], typeof ma[m]);
}
console.log(ma.on === ma.addListener, ma.off === ma.removeListener, ma.on === ma.once);
console.log(ma.tag, mb.tag, ma.pub, mb.pub, ma.nothing);
a.on('ping', (n: unknown) => console.log('ping', n));
console.log(ma.emit.call(a, 'ping', 3), ma.emit.call(a, 'pong'), ma.listenerCount.call(a, 'ping'));
ma.setMaxListeners.call(a, 3);
console.log(a.getMaxListeners(), ma.getMaxListeners.call(a), ma.eventNames.call(a));
