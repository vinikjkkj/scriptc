function make(prefix, n) {
  class Counter {
    constructor() { this.v = n; }
    constant() { return "C"; }
    viaCapture() { return prefix + n; }
    viaThis() { return this.v + 1; }
  }
  return new Counter();
}
function t1(c) { const { constant } = c; return constant(); }
function t2(c) { const { viaCapture } = c; return viaCapture(); }
function t3(c) { const { viaThis } = c; try { return viaThis(); } catch (e) { return e.name + ": " + e.message; } }
function t4(c, o) { const { viaCapture } = c; return viaCapture.call(o); }
const a = make("p", 1), b = make("q", 2);
function r(f) { try { return f(); } catch (e) { return "THROW " + e.message; } }
console.log(r(() => t1(a)), r(() => t2(a)), r(() => t3(a)), r(() => t4(a, b)));
function t5(c) { const { viaCapture } = c; return viaCapture; }
const f1 = t5(a), f2 = t5(a), g1 = t5(b);
console.log(f1 === f2, f1 === g1, f1.call(b), g1.call(a), f1.name);
