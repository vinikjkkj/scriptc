// An emitter's own cells (_events, _eventsCount, _maxListeners) belong to its listener registry: a write to
// one, spelled by name or through a key, has no lowering (it would shadow nothing the emitter reads).
import { EventEmitter } from 'events';

class Hub extends EventEmitter {
  label: string = 'hub';
  poke(k: string): void {
    // @ts-ignore
    this._eventsCount = 3;
    // @ts-ignore
    this['_events'] = {};
    // @ts-ignore
    this[k] = 1;
  }
}

const h = new Hub();
const names: string[] = process.argv.length > 99 ? ['zz'] : ['pub'];
Object.defineProperty(h, names[0], { value: 7, enumerable: true, writable: true, configurable: true });
h.poke('_maxListeners');
