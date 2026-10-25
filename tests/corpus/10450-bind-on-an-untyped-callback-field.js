// `this.onResult.bind(this, n)` where the field holds an untyped callback (the
// mysql2 command shape: `this.onResult = callback` in a constructor, bound at
// the call site). The bound function is a value: it runs the callback with the
// bound receiver and the bound leading arguments, its length is the target's
// minus the bound count (floored at zero), and it can be handed to a scheduler
// or invoked through call/apply, which cannot override the bound receiver.
// An absent callback is a TypeError at the property read, as in Node.

class Command {
  constructor(callback) {
    this.onResult = callback;
    this.tag = "cmd";
  }

  go(n) {
    if (this.onResult) {
      const f = this.onResult.bind(this, n);
      f(1, 2);
      console.log("len", f.length);
      const g = this.onResult.bind(this);
      g(7, 8, 9);
      console.log("len2", g.length);
    }
    return n;
  }

  later() {
    process.nextTick(this.onResult.bind(this, "tick"));
  }

  viaCall() {
    const h = this.onResult.bind(this, 3);
    return h.call(null, 4);
  }

  viaApply() {
    const h = this.onResult.bind(this, 3);
    return h.apply(null, [5]);
  }
}

function cb(a, b, c) {
  console.log("cb", this.tag, a, b, c);
  return a;
}

const p = new Command(cb);
p.go(5);
p.later();
console.log("apply", p.viaApply());
console.log("call", p.viaCall());

const q = new Command(undefined);
console.log(q.go(2));
try {
  q.later();
} catch (e) {
  console.log("threw", e.message);
}
