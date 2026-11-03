// `this[i]` over the keys of a for-in on an emitter-rooted class with a run-time property table is lowered only
// when its value is compared, typeof'd, tested or printed: one of the values is the emitter's `_events` view, a
// copy of a table Node lets a program mutate, so a value that is returned, stored or passed on keeps the refusal.
import { EventEmitter } from 'events';

class Hub extends EventEmitter {
  label: string = 'hub';
  collect(): unknown[] {
    const out: unknown[] = [];
    for (const i in this) {
      // @ts-ignore
      out.push(this[i]);
    }
    return out;
  }
  first(): unknown {
    for (const i in this) {
      // @ts-ignore
      const v = this[i];
      if (i === '_events') return v;
    }
    return null;
  }
}

const h = new Hub();
const names: string[] = process.argv.length > 99 ? ['zz'] : ['pub'];
Object.defineProperty(h, names[0], { value: 7, enumerable: true, writable: true, configurable: true });
console.log(h.collect().length, h.first());
