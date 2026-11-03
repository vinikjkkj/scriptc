// The once wrapper read from _events is Node's: calling it removes the listener, runs it with the emitter as
// `this`, and a second call does nothing; rawListeners answers the wrapper, listeners the original. A write of
// a number into _eventsCount / _maxListeners (undefined into the latter) is stored as events.js's own field.
import { EventEmitter } from 'events';

class Hub extends EventEmitter {
  label: string = 'hub';
}

const o = new Hub();
const names: string[] = process.argv.length > 99 ? ['zz'] : ['pub'];
Object.defineProperty(o, names[0], { value: 7, enumerable: true, writable: true, configurable: true });
const od: any = o;
o.once('p', (a: number, b: number): void => {
  console.log('once ran', a, b);
});
o.on('p', (): void => console.log('plain'));
const wr = od._events.p[0];
console.log(typeof wr, wr.listener.name, od.rawListeners('p')[0] === wr, od.listeners('p')[0] === wr.listener);
wr(1, 2);
console.log(od._eventsCount, od.listenerCount('p'), o.emit('p', 3, 4));
wr(5, 6);
od._eventsCount = 7;
od._maxListeners = 12;
console.log(od._eventsCount, od._maxListeners, o.getMaxListeners());
o.on('q', (): void => {});
console.log(od._eventsCount);
o.removeAllListeners('q');
console.log(od._eventsCount, od._events);
od._maxListeners = undefined;
console.log(od._maxListeners, o.getMaxListeners());
// The emitter-inheritance idiom: replacing _events with an empty object drops the listeners silently and the
// program's object becomes the table.
const e2 = new Hub();
Object.defineProperty(e2, names[0], { value: 7, enumerable: true, writable: true, configurable: true });
const d2: any = e2;
e2.on('gone', (): void => console.log('never'));
e2.on('removeListener', (): void => console.log('no meta'));
const table: any = Object.create(null);
const key: string = process.argv.length > 99 ? 'zz' : '_events';
d2[key] = table;
console.log(e2.emit('gone'), d2._events === table, d2._eventsCount, e2.listenerCount('gone'));
e2.on('back', (): void => console.log('back'));
console.log(d2._events === table, Object.keys(table).join(','), d2._eventsCount, e2.emit('back'));
console.log(e2.eventNames());
