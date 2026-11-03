// A program that lets an EventEmitter instance reach an untyped value may not write or delete the emitter's cells
// by name in a way the registry cannot hold: a literal _events, a non-number into _eventsCount or _maxListeners, a
// delete of one of the three. A receiver built in the program (a plain object) is left alone, and so are the
// numbers (and undefined for _maxListeners) the registry stores.
import { EventEmitter } from 'events';

class Hub extends EventEmitter {
  label: string = 'hub';
}

const h = new Hub();
const d: any = h;
const some: any = { a: 1 };

d._events = {};
d._maxListeners = 'many';
d._eventsCount = some.a;
delete d._maxListeners;
some._events = 1;
delete some._events;
d._maxListeners = 5;
d._eventsCount = undefined;
