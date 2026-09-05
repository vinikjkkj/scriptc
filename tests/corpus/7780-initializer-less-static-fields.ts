// A STATIC field with no initializer — `static tag?: string`, the shape
// mongodb's `AbstractOperation` opens with:
//
//     static aspects?: Set<symbol>;
//
// JS [[Define]]s the property on the class object when the class statement
// evaluates, at exactly the position a sibling `static x = e` would run, and
// a read before anything writes it answers `undefined`. That is one storage
// location with one `undefined` write — the same module global the
// initialized form already uses — so the only question the declaration asks
// is whether its type can HOLD undefined. `static tag?: string` and
// `static tag: string | undefined` both can; `static flag: boolean` cannot
// (tsc runs no definite-assignment check over statics, so that declaration
// is a type the storage never keeps) and stays refused.
//
// What is pinned here: the undefined a read answers BEFORE any write, on
// every payload kind an arm can carry; the position of that write among the
// initialized siblings and the static blocks; that one write per FAMILY, not
// per generic instantiation; and that the storage is ordinary afterwards —
// written, re-read, and reached from a class VALUE and from inside a method.

class Inner {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
}

function trace(s: string): number {
  console.log('init ' + s);
  return s.length;
}

class Slots {
  // Interleaved with initialized siblings and a static block on purpose: the
  // undefined write is a member-ordered statement like every other one, so
  // the block below sees `mid` already defined and holding undefined.
  static first = trace('first');
  static mid?: string;
  static {
    console.log('block sees mid =', Slots.mid);
    console.log('block sees mid === undefined:', Slots.mid === undefined);
  }
  static last = trace('last');

  // The payload kinds an arm can carry.
  static num?: number;
  static flag?: boolean;
  static rec?: { a: number; b: string };
  static arr?: number[];
  static inst?: Inner;
  // The `T | undefined` spelling is the same declaration.
  static spelled: string | undefined;
  // readonly is a type-world word here: the global is written once, by the
  // declaration itself, and never again.
  static readonly frozen?: string;
  // A PRIVATE static rides along under its spelled name.
  static #hidden?: number;

  static bumpHidden(): number {
    Slots.#hidden = (Slots.#hidden ?? 0) + 1;
    return Slots.#hidden;
  }

  static describe(): string {
    // Reached from inside a static method, before and after the writes.
    return Slots.mid === undefined ? 'unset' : Slots.mid;
  }
}

// A GENERIC family owns ONE storage location for every instantiation, the way
// JS has one class object.
class Box<T> {
  static seen?: number;
  v: T;
  constructor(v: T) {
    this.v = v;
  }
}

console.log('--- before any write');
console.log(Slots.mid);
console.log(Slots.mid === undefined);
console.log(Slots.num, Slots.flag, Slots.spelled, Slots.frozen);
console.log(Slots.rec, Slots.arr, Slots.inst);
console.log(Slots.describe());
console.log(Slots.first, Slots.last);

// The value flows into the places its type fits while still unset.
console.log(Slots.mid ?? 'fallback');
console.log(Slots.num ?? -1);
const held: (string | undefined)[] = [Slots.mid, Slots.spelled];
console.log(held.length, held[0], held[1]);

console.log('--- writes');
Slots.mid = 'written';
Slots.num = 42;
Slots.flag = false;
Slots.rec = { a: 7, b: 'seven' };
Slots.arr = [1, 2, 3];
Slots.inst = new Inner(9);
Slots.spelled = 'also written';

console.log(Slots.mid);
console.log(Slots.mid === undefined);
console.log(Slots.num, Slots.flag, Slots.spelled);
console.log(Slots.rec.a, Slots.rec.b);
console.log(Slots.arr.length, Slots.arr[0], Slots.arr[2]);
console.log(Slots.inst.n);
console.log(Slots.describe());

console.log('--- private');
console.log(Slots.bumpHidden());
console.log(Slots.bumpHidden());

console.log('--- through a class value');
const V = Slots;
console.log(V.mid, V.num);
V.mid = 'through the value';
console.log(Slots.mid);

console.log('--- one family, one slot');
console.log(Box.seen);
Box.seen = 3;
const bn = new Box<number>(1);
const bs = new Box<string>('s');
console.log(bn.v, bs.v);
console.log(Box.seen);
