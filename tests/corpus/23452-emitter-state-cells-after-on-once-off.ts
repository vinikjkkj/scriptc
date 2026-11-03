// The emitter's own cells read through `this[k]` in a for-in: _eventsCount, _maxListeners and the _events
// object after on / once / off / removeAllListeners / setMaxListeners (identity of the object and of its
// listeners, the once wrapper, the replaced object when the table empties).
import { EventEmitter } from 'events';

class Hub extends EventEmitter {
  label: string = 'hub';
  cells(): { count: unknown; max: unknown; events: any } {
    let count: unknown;
    let max: unknown;
    let events: any;
    for (const k in this) {
      // @ts-ignore
      const v = this[k];
      if (k === '_eventsCount') count = v;
      else if (k === '_maxListeners') max = v;
      else if (k === '_events') events = v;
    }
    return { count, max, events };
  }
  dump(tag: string): void {
    const c = this.cells();
    console.log(tag, 'count=', c.count, 'max=', c.max, 'names=', Object.keys(c.events).join(','));
  }
}

const h = new Hub();
const names: string[] = process.argv.length > 99 ? ['zz'] : ['pub'];
Object.defineProperty(h, names[0], { value: 7, enumerable: true, writable: true, configurable: true });

function f(): void {}
const g = (): void => {};
h.dump('fresh');
console.log(h.cells().events === h.cells().events);
const first = h.cells().events;
h.on('a', f);
h.dump('on a');
console.log(h.cells().events === first, h.cells().events['a'] === f);
h.once('b', g);
h.dump('once b');
const ev = h.cells().events;
console.log(ev['b'] === g, typeof ev['b'], ev['b'].listener === g);
console.log(h.cells().events);
h.on('a', g);
h.dump('a twice');
console.log(Array.isArray(ev['a']), ev['a'].length, ev === h.cells().events);
console.log(h.cells().events);
h.setMaxListeners(4);
h.dump('max 4');
h.off('a', f);
h.dump('off f');
console.log(ev['a'] === g);
h.emit('b');
h.dump('b fired');
h.removeAllListeners('a');
h.dump('removed a');
console.log(h.cells().events === first);
h.on('c', f);
h.removeAllListeners();
h.dump('wiped');
console.log(h.cells().events === first);
h.setMaxListeners(0);
h.dump('unlimited');
h.on('cycle', () => console.log(h.label));
h.once('self', () => console.log(h.label));
h.dump('cycle');
console.log(h.cells().events);
h.emit('self');
h.dump('self fired');
