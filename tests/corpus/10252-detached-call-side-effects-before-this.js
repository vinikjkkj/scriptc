// A method read as a value and then called with no receiver: Node runs the body
// with `this` undefined, so every statement before the first `this` member
// access still runs, and the TypeError is thrown AT that access. The message
// names the member. Covered: a read through a non-name receiver (`new C().m`),
// a write (`this.n = 1`, whose TypeError names the write), and a read after a
// side effect that already reached a sink.

class C {
  constructor() {
    this.n = 0;
  }

  m(p, sink) {
    sink.push("before:" + p);
    return this.n;
  }

  w(p, sink) {
    sink.push("w:" + p);
    this.n = 1;
    return this.n;
  }
}

const sink = [];
const f = new C().m;
try {
  console.log("m", f("x", sink));
} catch (e) {
  console.log("m threw", e instanceof TypeError, e.message, sink.join(","));
}

const c = new C();
const g = c.w;
try {
  console.log("w", g("y", sink));
} catch (e) {
  console.log("w threw", e instanceof TypeError, e.message, sink.join(","));
}

// The receiver still works when it IS an instance: the same function value, called
// through `.call`, runs the body normally.
console.log("call", g.call(c, "z", sink), c.n, sink.join(","));
