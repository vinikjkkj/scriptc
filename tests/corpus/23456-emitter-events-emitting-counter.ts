// events.emitting: the enumerable symbol of a listener ARRAY counts the emits in flight on that very array, and
// an add or a remove during an emit clones the array (the emit keeps the old one), so a held array stays live
// until then.
import { EventEmitter } from 'events';

class Hub extends EventEmitter {
  label: string = 'hub';
}

const h = new Hub();
const names: string[] = process.argv.length > 99 ? ['zz'] : ['pub'];
Object.defineProperty(h, names[0], { value: 7, enumerable: true, writable: true, configurable: true });
const d: any = h;

let step = 0;
let held: any = null;
const first = (): void => {
  step++;
  if (step === 1) {
    console.log('in emit 1', d._events.a === held, d._events.a);
    h.emit('a');
    console.log('after nested', d._events.a);
    h.on('a', () => console.log('late'));
    console.log('cloned by add', d._events.a === held, held.length, d._events.a.length);
  }
};
h.on('a', first);
h.on('a', (): void => console.log('second'));
held = d._events.a;
console.log(held);
h.emit('a');
console.log('after emit', d._events.a === held, d._events.a);
h.prependListener('a', (): void => {});
console.log(d._events.a.length, d._events.a);
h.removeAllListeners('a');
console.log(d._events);
