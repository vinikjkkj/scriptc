'use strict';
// listenerCount on an untyped receiver tracks adds and removes made through
// the same untyped receiver, and a chained form returns the receiver.
const EventEmitter = require('events');
class Hub extends EventEmitter {
  constructor() { super(); this.label = 'hub'; }
}
function probe(src) {
  const n0 = src.listenerCount('tick');
  const a = () => console.log('a');
  const b = () => console.log('b');
  const r = src.on('tick', a);
  console.log('same', r === src, n0, src.listenerCount('tick'));
  src.on('tick', b);
  console.log('two', src.listenerCount('tick'));
  src.removeListener('tick', a);
  console.log('one', src.listenerCount('tick'));
}
probe(new Hub());
