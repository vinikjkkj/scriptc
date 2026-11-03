// A program that lets an EventEmitter instance reach an untyped value may not write or delete a dyn key in a way
// that could change the emitter's cells or its `_events` view: the registry holds them, and a write the lowering
// cannot reproduce is refused where it is written (a literal _events, a non-number into _eventsCount or
// _maxListeners, any delete, any write through a computed key).
import { EventEmitter } from 'events';

class Hub extends EventEmitter {
  label: string = 'hub';
}

const h = new Hub();
const d: any = h;
const key: string = process.argv.length > 99 ? 'zz' : 'label';
const some: any = { a: 1 };

d._events = {};
d._maxListeners = 'many';
d._eventsCount = some.a;
delete d._maxListeners;
delete some[key];
some[key] = 1;
d[key] = 2;
d._maxListeners = 5;
d._eventsCount = undefined;
