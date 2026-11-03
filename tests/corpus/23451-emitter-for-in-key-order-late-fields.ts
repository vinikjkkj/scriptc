// for-in over an EventEmitter subclass with a run-time property table: the emitter's own cells, the
// constructor's fields, fields assigned later, table keys in insertion order (a deleted key re-added goes
// last), then the enumerable EventEmitter.prototype members.
import { EventEmitter } from 'events';

class Job extends EventEmitter {
  a: number = 1;
  b: string = 'two';
  id: number;
  constructor(id: number) {
    super();
    this.id = id;
    this.c = [id];
  }
  c: number[];
  d: unknown;
  setLate(): void {
    this.d = 'late';
  }
  keys(): string {
    const out: string[] = [];
    for (const i in this) out.push(i);
    return out.join(',');
  }
  seen(): string {
    const out: string[] = [];
    for (const i in this) {
      // @ts-ignore
      const v = this[i];
      out.push(i + ':' + typeof v);
    }
    return out.join(' ');
  }
}

const j = new Job(5);
const names: string[] = process.argv.length > 99 ? ['zz'] : ['t1', 't2', 't3'];
console.log(j.keys());
Object.defineProperty(j, names[0], { value: 1, enumerable: true, writable: true, configurable: true });
Object.defineProperty(j, names[1], { value: 2, enumerable: true, writable: true, configurable: true });
console.log(j.keys());
j.setLate();
console.log(j.keys());
Object.defineProperty(j, names[2], { value: 3, enumerable: false, writable: true, configurable: true });
console.log(j.keys());
console.log(j.seen());
j.on('x', () => {});
j.once('y', () => {});
console.log(j.seen());
