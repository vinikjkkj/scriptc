/* Fixture for protoclass-probe.cjs. Run:
 *   node tests/perf/dynpath/protoclass-probe.cjs tests/perf/dynpath/arrow-proto-method.js
 *
 * `bad` must NOT be collected as a method and the class must be REFUSED. An
 * arrow captures `this` lexically, so `a.bad()` never touches `a` -- in this CJS
 * module `this` is module.exports. Lowering it as a method would bind `this` to
 * the receiver and write a.x = 99, which Node does not do, and the field walk
 * would credit that write to the instance shape (x*2 rather than x*1).
 *
 * The recognizer accepted this before 2026-09-02. It is kept as a fixture rather
 * than a unit test because the recognizer needs a parsed SourceFile, and the TS7
 * adapter has no createSourceFile -- the probe's 5.9.3 island is the only place
 * this can be exercised without a build. */
function A(b) { this.x = 0; this.buf = b }
A.prototype.good = function () { this.x = this.x + 1; return this.x };
A.prototype.bad = () => { this.x = 99; return 1 };
module.exports = A;
