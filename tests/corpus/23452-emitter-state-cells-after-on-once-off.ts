// The emitter's own cells read from an untyped slot: _eventsCount, _maxListeners and the _events object after
// on / once / off / removeAllListeners / setMaxListeners (identity of the object and of its listeners, the
// once wrapper, the replaced object when the table empties).
import { EventEmitter } from 'events';

class Hub extends EventEmitter {
  label: string = 'hub';
}

const h = new Hub();
const names: string[] = process.argv.length > 99 ? ['zz'] : ['pub'];
Object.defineProperty(h, names[0], { value: 7, enumerable: true, writable: true, configurable: true });
const d: any = h;

function dump(tag: string): void {
  console.log(tag, 'count=', d._eventsCount, 'max=', d._maxListeners, 'names=', Object.keys(d._events).join(','));
}

function f(): void {}
const g = (): void => {};
dump('fresh');
console.log(d._events === d._events);
const first = d._events;
h.on('a', f);
dump('on a');
console.log(d._events === first, d._events['a'] === f);
h.once('b', g);
dump('once b');
const ev = d._events;
console.log(ev['b'] === g, typeof ev['b'], ev['b'].listener === g);
console.log(d._events);
h.on('a', g);
dump('a twice');
console.log(Array.isArray(ev['a']), ev['a'].length, ev === d._events);
console.log(d._events);
h.setMaxListeners(4);
dump('max 4');
h.off('a', f);
dump('off f');
console.log(ev['a'] === g);
h.emit('b');
dump('b fired');
h.removeAllListeners('a');
dump('removed a');
console.log(d._events === first);
h.on('c', f);
h.removeAllListeners();
dump('wiped');
console.log(d._events === first);
h.setMaxListeners(0);
dump('unlimited');
h.on('cycle', () => console.log(h.label));
h.once('self', () => console.log(h.label));
dump('cycle');
console.log(d._events);
h.emit('self');
dump('self fired');
