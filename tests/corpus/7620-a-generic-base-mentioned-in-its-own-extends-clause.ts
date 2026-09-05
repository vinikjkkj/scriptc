// A generic class whose `extends` clause mentions its OWN type parameters —
// `class Wrap<T> extends Box<T>` — has no single base: `Wrap<number>` extends
// `Box<number>` and `Wrap<string>` extends `Box<string>`, two unrelated
// compiled classes. The family SPLITS: it keeps the statics and the symbol,
// and each instantiation extends the base its own arguments named.
//
// What that has to buy is dispatch through a base-typed reference at EVERY
// instantiation. A dishonest tree here has no diagnostic — a call reads the
// wrong field or reaches the wrong body and exits 0.
class Box<T> {
  v: T;
  constructor(v: T) {
    this.v = v;
  }
  show(): string {
    return 'Box(' + String(this.v) + ')';
  }
  tag(): string {
    return 'box';
  }
}
class Wrap<T> extends Box<T> {
  n: number;
  constructor(v: T, n: number) {
    super(v);
    this.n = n;
  }
  show(): string {
    return 'Wrap(' + String(this.v) + ',' + this.n + ')';
  }
}
// A subclass that FIXES the parameter, beside instantiations that keep it.
class Fixed extends Wrap<string> {
  show(): string {
    return 'Fixed(' + this.v + ',' + this.n + ')';
  }
}

const bn: Box<number> = new Wrap<number>(7, 1);
const bs: Box<string> = new Wrap<string>('a', 2);
const bf: Box<string> = new Fixed('z', 3);
console.log(bn.show(), bn.tag(), bn.v);
console.log(bs.show(), bs.tag(), bs.v);
console.log(bf.show(), bf.tag(), bf.v);
const wn: Wrap<number> = new Wrap<number>(9, 4);
console.log(wn.show(), wn.n, wn.v);
// The un-split base still answers `instanceof` for its whole family.
const plain = new Box<number>(5);
console.log(plain.show(), plain.tag(), plain.v);
console.log(bn instanceof Box, bs instanceof Box, bf instanceof Box);
