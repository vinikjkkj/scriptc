// The identity and the unbound call of a method reference. `this.m` and
// `C.prototype.m` are one function value per declaring class: they compare
// equal when the receiver does not override m, and differ when a subclass
// does. A detached value called with no receiver throws TypeError at the
// first `this` read, and a value stored in a field or returned through a
// union keeps all of that.

class Base {
  constructor() {
    this.step = null;
    this.hits = 0;
  }

  first(token, sink) {
    sink.push("first:" + token);
    return token === "stop" ? null : this.second;
  }

  second(token, sink) {
    this.hits++;
    sink.push("second:" + token);
    return token === "stop" ? null : this.second;
  }

  pick(flag) {
    return flag ? this.first : null;
  }
}

class Child extends Base {
  second(token, sink) {
    this.hits += 10;
    sink.push("child:" + token);
    return token === "stop" ? null : this.second;
  }
}

const b = new Base();
const c = new Child();
const sink = [];

console.log("same-base", b.first === Base.prototype.first, b.second === Base.prototype.second);
console.log("same-child-inherited", c.first === Base.prototype.first, c.first === b.first);
console.log("override", c.second === Child.prototype.second, c.second === Base.prototype.second);
console.log("prototype-identity", Child.prototype.second === c.second, typeof b.second);

// A driver stores the next handler in a field and calls it with its own receiver.
b.step = b.first;
let token = "a";
for (const t of ["a", "b", "stop"]) {
  token = t;
  b.step = b.step(token, sink);
  if (b.step === null) break;
}
console.log(sink.join(","), b.hits, b.step === null);

c.step = c.first;
c.step = c.step("x", sink);
c.step = c.step("y", sink);
console.log(sink.slice(-2).join(","), c.hits);

// Read through a union: the function-or-null return of `pick`.
const got = c.pick(true);
console.log("picked", got === c.first, c.pick(false) === null);

// A detached handler with no receiver: strict class bodies throw TypeError
// at `this`, and nothing reaches the sink.
const detached = b.second;
const before = sink.length;
try {
  detached("z", sink);
  console.log("no throw");
} catch (e) {
  console.log("threw", e instanceof TypeError, sink.length === before);
}
