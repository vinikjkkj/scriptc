// A method of a class declared in a function, called with no receiver (read off an instance and destructured, then called): its body
// runs, and it throws Node's TypeError only where it touches `this`. A method that reads none of the captured locals needs nothing
// from the evaluation, so these are exact; the captured-local reads through a detached receiver are a separate matter.
function make(prefix, n) {
  class Counter {
    constructor() { this.v = n; }
    constant() { return "C"; }
    twice(x) { return x * 2; }
    viaThis() { return this.v + 1; }
    viaCapture() { return prefix + n; }
  }
  return new Counter();
}
function constant(c) { const { constant } = c; return constant(); }
function twice(c) { const f = c.twice; return f(21); }
function viaThis(c) { const { viaThis } = c; try { return viaThis(); } catch (e) { return e.name + ": " + e.message; } }
function withReceiver(c, other) { const f = c.viaThis; return f.call(other); }
const a = make("p", 1), b = make("q", 2);
console.log(constant(a), twice(b), viaThis(a), withReceiver(a, b), a.viaCapture(), b.viaCapture());
