// A field the constructor never wrote is ABSENT in Node, and util.inspect
// does not print a key that is not there. `in` has read a checked-dynamic
// slot's undefined kind as absence since collected fields existed; the
// inspect surface had the union arm only, so a deferred-callback slot
// printed `cb: undefined` where Node prints nothing.
//
// Both absence mechanisms appear here on ONE instance of Mixed: `n` is an
// undefined-armed UNION slot, `cb` is the checked-dynamic callback slot.
// They are per-field and independent -- neither overrides the other.
class Latch {
  constructor(flag) {
    this.tag = flag ? "yes" : "no";
    if (flag) this.arm();
  }
  arm() {
    this.cb = (v) => v + 1;
  }
}

class Mixed {
  constructor(flag) {
    this.tag = "t";
    if (flag) {
      this.n = 1;
      this.cb = (v) => v + 1;
    }
  }
}

// Inheritance: the slot is declared on a base and the subclass instance
// inherits both the slot and its absence. Only the SUBCLASS is printed --
// a printed base whose class has subclasses has no inspect lowering at all,
// which is a different rule and would hide this one.
class Root {
  constructor(flag) {
    this.tag = flag ? "yes" : "no";
    if (flag) this.arm();
  }
  arm() {
    this.cb = (v) => v + 1;
  }
}

class Kid extends Root {
  constructor(flag) {
    super(flag);
    this.extra = 2;
  }
}

function main() {
  const on = new Latch(true);
  const off = new Latch(false);
  console.log(on);
  console.log(off);
  console.log("in:", "cb" in on, "cb" in off);
  console.log("typeof:", typeof on.cb, typeof off.cb);
  console.log(on.cb(1));

  const mon = new Mixed(true);
  const moff = new Mixed(false);
  console.log(mon);
  console.log(moff);
  console.log("in n:", "n" in mon, "n" in moff);
  console.log("in cb:", "cb" in mon, "cb" in moff);

  console.log(new Kid(true));
  console.log(new Kid(false));

  // At depth and inside a container, where the same skip has to hold.
  console.log([off, off]);
  console.log({ a: moff });
}

main();
