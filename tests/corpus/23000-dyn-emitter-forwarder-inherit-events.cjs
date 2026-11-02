'use strict';
// mysql2 lib/promise/inherit_events.js, verbatim shape: a dyn-receiver forwarder that
// re-emits the source's events on the target through emit.apply(target, args).
const { EventEmitter } = require('events');

function inheritEvents(source, target, events) {
  const listeners = {};
  target
    .on('newListener', (eventName) => {
      if (events.indexOf(eventName) >= 0 && !target.listenerCount(eventName)) {
        source.on(
          eventName,
          (listeners[eventName] = function () {
            const args = [].slice.call(arguments);
            args.unshift(eventName);

            target.emit.apply(target, args);
          })
        );
      }
    })
    .on('removeListener', (eventName) => {
      if (events.indexOf(eventName) >= 0 && !target.listenerCount(eventName)) {
        source.removeListener(eventName, listeners[eventName]);
        delete listeners[eventName];
      }
    });
}

class PromisePool extends EventEmitter {
  constructor(src) {
    super();
    this.tag = 'pool';
    inheritEvents(src, this, ['acquire', 'connection', 'enqueue', 'release', 'error']);
  }
}

const src = new EventEmitter();
const pool = new PromisePool(src);
console.log('before', src.listenerCount('acquire'), src.listenerCount('error'));
pool.on('acquire', (c) => console.log('acquire', c));
pool.on('connection', (c, extra) => console.log('connection', c, extra));
pool.once('release', (c) => console.log('release once', c));
console.log('after on', src.listenerCount('acquire'), src.listenerCount('connection'), src.listenerCount('release'));
src.emit('acquire', 1);
src.emit('connection', 2, 'x');
src.emit('release', 3);
src.emit('release', 4);
console.log('after once', src.listenerCount('release'), pool.listenerCount('release'));
// 'error' with a listener on the pool: forwarded
pool.on('error', (e) => console.log('pool error', e.message));
src.emit('error', new Error('boom'));
// removing the last pool listener detaches the forwarder
pool.removeAllListeners('error');
console.log('detached', src.listenerCount('error'));
// 'error' with no listener anywhere: the source throws
try {
  src.emit('error', new Error('unhandled'));
} catch (e) {
  console.log('caught', e.message);
}
// an event the pool does not forward never reaches it
pool.on('other', () => console.log('never'));
src.emit('other');
console.log('done', pool.tag);
