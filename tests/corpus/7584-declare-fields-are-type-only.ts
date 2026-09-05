// `declare x: T` in a class body is TYPE-ONLY: TypeScript emits nothing
// for it — not even the `undefined` write a bare `x;` performs. It restates
// the type of a property some other mechanism supplies, which is how
// mongodb's `MongoMissingDependencyError` spells `declare cause: Error`
// over a property the Error constructor assigned.
//
// So a `declare` redeclaration must leave the inherited value ALONE, where
// a bare redeclaration resets it to undefined.
class Base {
  x: number = 1;
  label: string = 'base';
  seq: number[] = [1, 2];
}

class Declared extends Base {
  declare x: number;
  declare label: string;
  constructor() {
    super();
  }
}

const d = new Declared();
console.log(d.x, d.label, d.seq.length);

// A `declare` beside real members, and one on a class with its own
// constructor work that runs after super().
class Mixed extends Base {
  declare x: number;
  own: string;
  constructor(own: string) {
    super();
    this.own = own;
  }
  describe(): string {
    return this.own + ':' + String(this.x) + ':' + this.label;
  }
}
const m = new Mixed('m');
console.log(m.describe(), m.x, m.own);

// The inherited slot is still writable and still one slot: a write through
// the DECLARED view is the same memory the base view reads.
m.x = 9;
function readBase(b: Base): number {
  return b.x;
}
console.log(m.x, readBase(m));

// Two levels of `declare` over one real field.
class Deeper extends Mixed {
  declare x: number;
  declare label: string;
}
const deep = new Deeper('deep');
console.log(deep.x, deep.label, deep.describe(), readBase(deep));

// A `declare` that redeclares a field the base initialized to a REFERENCE
// keeps the very same array, not a fresh one.
class Shared extends Base {
  declare seq: number[];
}
const sh = new Shared();
sh.seq.push(3);
console.log(sh.seq.length, sh.seq.join('-'));
