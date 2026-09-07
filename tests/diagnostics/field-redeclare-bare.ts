// The two walls a BARE redeclare (`override x: T;`, no initializer) can hit,
// each named for what actually blocks it.
//
// (1) A DIFFERENT type. These layouts give the property one slot, and one
//     slot cannot answer both spellings — reporting only the missing
//     initializer here sent two rounds of work after the reset semantics
//     when the real wall was the slot.
interface Opts {
  a?: number;
}
interface WideOpts extends Opts {
  b?: number;
}
class Base {
  options: Opts;
  constructor(o: Opts) {
    this.options = o;
  }
}
class Wider extends Base {
  override options: WideOpts;
  constructor(o: WideOpts) {
    super(o);
    this.options = o;
  }
}

// (2) The SAME type, but a slot that cannot hold undefined and a reset the
//     program can observe: a method call runs between the reset and the
//     assignment, and Node's `peek()` there reads the undefined the reset
//     wrote. Erasing the reset would answer 1 where Node answers undefined.
class Counter {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
  peek(): number {
    return this.n;
  }
}
class Observed extends Counter {
  override n: number;
  constructor(n: number) {
    super(n);
    console.log("mid", this.peek());
    this.n = n + 1;
  }
}

// (3) The same type again, with the assignment behind a branch: nothing
//     guarantees the reset is overwritten before the constructor returns.
class Branched extends Counter {
  override n: number;
  constructor(n: number) {
    super(n);
    if (n > 0) {
      this.n = n;
    } else {
      this.n = -n;
    }
  }
}

// (4) The same type again, and an intervening write whose right-hand side
//     CAN run user code: a template substitution over a class instance
//     calls its `toString`, and that call could read the very field the
//     reset just cleared. The window is only empty when nothing in it
//     runs, so the inert-expression whitelist admits scalars and refuses
//     this.
class Tag {
  toString(): string {
    return "tag";
  }
}
class Coerced extends Counter {
  override n: number;
  label: string;
  constructor(n: number, t: Tag) {
    super(n);
    this.label = `${t}`;
    this.n = n + 1;
  }
}

console.log(new Wider({ a: 1, b: 2 }).options.b);
console.log(new Observed(1).n);
console.log(new Branched(2).n);
console.log(new Coerced(1, new Tag()).label);
