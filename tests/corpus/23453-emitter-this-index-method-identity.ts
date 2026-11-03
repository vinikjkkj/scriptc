// `this[k]` over the EventEmitter.prototype member names a for-in yields: compared with the same member of
// another instance (one function per member), and the functions read from an untyped slot behave as Node's
// (`on` is `addListener`, `off` is `removeListener`, callable through the read).
import { EventEmitter } from 'events';

class Hub extends EventEmitter {
  tag: string;
  constructor(tag: string) {
    super();
    this.tag = tag;
  }
  fnNames(): string {
    const out: string[] = [];
    for (const k in this) {
      // @ts-ignore
      if (typeof this[k] === 'function') out.push(k);
    }
    return out.join(',');
  }
  sameAs(other: any): string {
    const out: string[] = [];
    for (const k in this) {
      // @ts-ignore
      out.push(k + ':' + (this[k] === other[k]));
    }
    return out.join(' ');
  }
}

const a = new Hub('a');
const b = new Hub('b');
const names: string[] = process.argv.length > 99 ? ['zz'] : ['pub'];
Object.defineProperty(a, names[0], { value: 7, enumerable: true, writable: true, configurable: true });
Object.defineProperty(b, names[0], { value: 8, enumerable: true, writable: true, configurable: true });

console.log(a.fnNames());
console.log(a.sameAs(b));
const da: any = a;
const db: any = b;
const fns = ['setMaxListeners', 'getMaxListeners', 'emit', 'addListener', 'on', 'prependListener', 'once',
  'prependOnceListener', 'removeListener', 'off', 'removeAllListeners', 'listeners', 'rawListeners', 'listenerCount',
  'eventNames'];
for (const m of fns) {
  console.log(m, da[m] === db[m], da[m] === da[m], typeof da[m]);
}
console.log(da.on === da.addListener, da.off === da.removeListener, da.on === da.once);
console.log(da.tag, db.tag, da.pub, db.pub, da.nothing);
a.on('ping', (n: unknown) => console.log('ping', n));
console.log(da.emit.call(a, 'ping', 3), da.emit.call(a, 'pong'), da.listenerCount.call(a, 'ping'));
da.setMaxListeners.call(a, 3);
console.log(a.getMaxListeners(), da.getMaxListeners.call(a), da.eventNames.call(a));
