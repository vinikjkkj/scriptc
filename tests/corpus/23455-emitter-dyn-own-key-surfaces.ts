// The same emitter instance held in an untyped slot: `in`, Object.hasOwn and the cells read by name, with
// integer-like event names ordered the way a JavaScript object orders its keys.
import { EventEmitter } from 'events';

class Hub extends EventEmitter {
  label: string = 'hub';
}

const h = new Hub();
const names: string[] = process.argv.length > 99 ? ['zz'] : ['pub'];
Object.defineProperty(h, names[0], { value: 7, enumerable: true, writable: true, configurable: true });
const d: any = h;
console.log('_events' in d, '_eventsCount' in d, '_maxListeners' in d, 'emit' in d, 'label' in d, 'nope' in d);
console.log(Object.hasOwn(d, '_events'), Object.hasOwn(d, '_eventsCount'), Object.hasOwn(d, 'emit'), Object.hasOwn(d, 'label'), Object.hasOwn(d, 'pub'), Object.hasOwn(d, 'nope'));
h.on('b', () => {});
h.on('1', () => {});
h.on('a', () => {});
h.once('10', () => {});
console.log(Object.keys(d._events).join(','), h.eventNames().join(','));
console.log(d._eventsCount, d._maxListeners, typeof d._events);
h.once('self', () => console.log(h.label));
console.log(Object.keys(d._events).join(','));
h.emit('self');
console.log(Object.keys(d._events).join(','), d._eventsCount);
