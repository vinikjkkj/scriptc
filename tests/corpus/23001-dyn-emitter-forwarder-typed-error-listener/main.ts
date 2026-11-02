/* eslint-disable @typescript-eslint/no-explicit-any -- the rows exercise untyped (any) receivers on purpose */
import { EventEmitter } from 'events';
import inheritEvents from './inh.cjs';

// A forwarder written in JS re-emits through emit.apply on the target while typed listeners
// (an Error-typed 'error' listener on an unrelated emitter, a number-typed one on the pool)
// are registered elsewhere: the dynamic argument list reaches the typed listeners.
class Pool extends EventEmitter {
  constructor(src: any) {
    super();
    inheritEvents(src, this, ['acq', 'error', 'enq']);
  }
}
class Writer extends EventEmitter {}
const w = new Writer();
w.on('error', (e: Error) => { console.log('writer error', e.message); });
const src = new EventEmitter();
const p = new Pool(src);
p.on('acq', (x: number) => { console.log('acq', x); });
p.on('enq', () => { console.log('enq'); });
p.on('error', (e: Error) => { console.log('pool error', e.message); });
src.emit('acq', 7);
src.emit('enq');
src.emit('error', new Error('boom'));
p.removeAllListeners('error');
src.emit('acq', 8);
w.emit('error', new Error('w'));
console.log('src listeners', src.listenerCount('error'), src.listenerCount('acq'));
console.log('done');
