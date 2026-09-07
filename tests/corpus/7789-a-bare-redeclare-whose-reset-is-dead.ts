// The other half of the bare redeclare: a slot that CANNOT hold undefined.
// The reset cannot be written there, so it is ERASED — and erasing it is
// exact only where nothing observes the field between the reset and the
// constructor's own assignment. Node's order is super() → this class's
// field initializers (the reset among them) → the constructor body, so the
// window is the initializers declared after this member plus the top-level
// statements before the assignment. Both must be empty of anything that
// can run: the proof is syntactic, and everything it cannot prove keeps
// the fence (a reset erased where the program CAN see it would answer the
// base's value where Node answers undefined).
class Counter {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
  describe(): string {
    return `n=${this.n}`;
  }
}

// Adjacent assignment.
class Doubled extends Counter {
  override n: number;
  constructor(n: number) {
    super(n);
    this.n = n * 2;
  }
}

// One intervening write to another field, with an inert right-hand side.
class Labeled extends Counter {
  override n: number;
  label: string;
  constructor(n: number, label: string) {
    super(n);
    this.label = label;
    this.n = n + 1;
  }
}

// A nullish-coalescing right-hand side over a parameter — mongodb's
// `this.options = options ?? {}` in operand form.
class Defaulted extends Counter {
  override n: number;
  constructor(n?: number) {
    super(0);
    this.n = n ?? 7;
  }
}

const d = new Doubled(21);
const l = new Labeled(1, "L");
const f = new Defaulted();
const g = new Defaulted(3);
console.log(d.n, d.describe());
console.log(l.n, l.label, l.describe());
console.log(f.n, g.n, f.describe());
// The base view reads the same one slot.
const asBase: Counter = d;
console.log(asBase.n, asBase.describe(), new Counter(9).n);

// A string slot, and a subclass of the subclass that does not redeclare.
class Tag {
  s: string;
  constructor(s: string) {
    this.s = s;
  }
}
class Loud extends Tag {
  override s: string;
  constructor(s: string) {
    super(s);
    this.s = s + "!";
  }
}
class Louder extends Loud {
  constructor(s: string) {
    super(s + "?");
  }
}
console.log(new Loud("a").s, new Louder("b").s, new Tag("c").s);
