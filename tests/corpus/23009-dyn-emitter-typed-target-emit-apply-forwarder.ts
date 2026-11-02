/* eslint-disable @typescript-eslint/no-explicit-any, prefer-spread -- the rows exercise untyped (any) receivers on purpose */
import { EventEmitter } from 'events';

// The forwarder written in TypeScript: the target is a typed emitter, the source an untyped one, and
// the re-emit applies a runtime argument list to typed listeners.
function inheritEvents(source: any, target: EventEmitter, events: string[]): void {
  const listeners: { [name: string]: (...args: unknown[]) => void } = {};
  target
    .on('newListener', (eventName: string) => {
      if (events.indexOf(eventName) >= 0 && !target.listenerCount(eventName)) {
        source.on(
          eventName,
          (listeners[eventName] = function (...args: unknown[]) {
            args.unshift(eventName);
            target.emit.apply(target, args as [string, ...unknown[]]);
          })
        );
      }
    })
    .on('removeListener', (eventName: string) => {
      if (events.indexOf(eventName) >= 0 && !target.listenerCount(eventName)) {
        source.removeListener(eventName, listeners[eventName]);
        delete listeners[eventName];
      }
    });
}

class Pool extends EventEmitter {
  constructor(src: any) {
    super();
    inheritEvents(src, this, ['acq', 'error', 'pair']);
  }
}
const src = new EventEmitter();
const p = new Pool(src);
p.on('acq', (x: number) => console.log('acq', x));
p.on('pair', (a: string, b: number) => console.log('pair', a, b));
p.on('error', (e: Error) => console.log('pool error', e.message));
src.emit('acq', 7);
src.emit('pair', 'k', 2);
src.emit('error', new Error('boom'));
console.log(src.listenerCount('acq'), src.listenerCount('pair'), src.listenerCount('error'));
p.removeAllListeners('acq');
console.log(src.listenerCount('acq'), p.listenerCount('acq'));
try { src.emit('acq', 1); console.log('no listener, no throw'); } catch { console.log('threw'); }
