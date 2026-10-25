'use strict';
// Chained subscribe members on a program subclass of EventEmitter: each
// call returns the receiver (`this`), so the chain keeps dispatching on
// the same instance. Listeners fire in registration order; off() detaches
// exactly the listener it was given and once() fires a single time.
const EventEmitter = require('events').EventEmitter;
class Bus extends EventEmitter {
  constructor(tag) { super(); this.tag = tag; }
  wire(a, b) {
    return this.on('a', a).once('b', b).on('c', (v) => console.log('c saw', v));
  }
}
const bus = new Bus('x');
const r = bus.wire(() => console.log('A1'), () => console.log('B once'));
console.log('same receiver', r === bus);
bus.emit('a');
bus.emit('b');
bus.emit('b');
bus.emit('c', 7);
console.log('a count', bus.listenerCount('a'), 'b count', bus.listenerCount('b'));
const fn = () => console.log('A2');
bus.on('a', fn).off('a', fn);
bus.emit('a');
console.log('a after off', bus.listenerCount('a'));
