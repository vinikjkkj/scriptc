// A subclass chain over an EventEmitter root (the leaf carries a run-time property table, the bases do not):
// each level's constructor fields keep their creation order, the emitter's cells and prototype members
// bracket them, and `this[i]` in the base's method reads every yielded key off the leaf instance.
import { EventEmitter } from 'events';

class Base extends EventEmitter {
  next: unknown = null;
  baseField: number = 1;
  stateName(): string {
    const state = this.next;
    for (const i in this) {
      // @ts-ignore
      if (this[i] === state && i !== 'next') return i;
    }
    return 'unknown name';
  }
  allKeys(): string[] {
    const out: string[] = [];
    for (const i in this) out.push(i);
    return out;
  }
}
class Mid extends Base {
  midField: string = 'm';
  lateMid: boolean | undefined;
  late(): void {
    this.lateMid = true;
  }
}
class Leaf extends Mid {
  leafField: number[] = [1, 2];
  step: (() => number) | null = null;
}

const names: string[] = process.argv.length > 99 ? ['zz'] : ['extra'];
const leaf = new Leaf();
Object.defineProperty(leaf, names[0], { value: 'x', enumerable: true, writable: true, configurable: true });
console.log(leaf.allKeys().join(','));
leaf.late();
console.log(leaf.allKeys().join(','));
const fn = (): number => 4;
leaf.step = fn;
leaf.next = fn;
console.log(leaf.stateName());
leaf.next = leaf.leafField;
console.log(leaf.stateName());
leaf.next = 'x';
console.log(leaf.stateName());
leaf.next = leaf.step;
leaf.step = null;
console.log(leaf.stateName());
const mid = new Mid();
console.log(mid.allKeys().join(','));
mid.next = mid.midField;
console.log(mid.stateName());
const base = new Base();
console.log(base.allKeys().join(','), base.stateName());
base.on('x', () => {});
base.next = base.baseField;
console.log(base.allKeys().join(','), base.stateName());
