// mysql2's Command.stateName(): `for (const i in this) if (this[i] === state && i !== 'next')` over an
// EventEmitter subclass that carries a run-time property table (the defineProperty with a run-time key).
import { EventEmitter } from 'events';

class Command extends EventEmitter {
  next: unknown = null;
  sql: string = 'select 1';
  handler: unknown = null;
  stateName(): string {
    const state = this.next;
    for (const i in this) {
      // @ts-ignore
      if (this[i] === state && i !== 'next') {
        return i;
      }
    }
    return 'unknown name';
  }
}

const c = new Command();
const names: string[] = process.argv.length > 99 ? ['zz'] : ['pub', 'late'];
Object.defineProperty(c, names[0], { value: 7, enumerable: true, writable: true, configurable: true });

console.log(c.stateName());
const f = (): number => 1;
const g = (): number => 2;
c.next = f;
console.log(c.stateName());
c.handler = f;
console.log(c.stateName());
c.handler = g;
console.log(c.stateName());
c.next = 'select 1';
console.log(c.stateName());
c.next = 7;
console.log(c.stateName());
c.next = undefined;
console.log(c.stateName());
c.next = c.sql;
console.log(c.stateName());
