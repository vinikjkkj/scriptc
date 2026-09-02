/* Fixture for protoclass-probe.cjs. Run:
 *   node tests/perf/dynpath/protoclass-probe.cjs tests/perf/dynpath/conditional-field.js
 *
 * `b` is assigned only when `o` is truthy, so B must be REFUSED. The slot exists
 * on every instance, but on the path that skips the assignment nothing writes
 * it: Node reads undefined, a fixed layout reads whatever the allocation left.
 *
 * Typing the slot to admit undefined is necessary and not sufficient -- something
 * has to WRITE the undefined, and fieldInitStmts emits nothing for a fieldOrder
 * entry with no initializer, which is what a prototype-class produces (its
 * assignments live in the constructor body). Fixing it properly needs a
 * synthesized `undefined` expression node. */
function B(o) { this.a = 1; if (o) { this.b = o } }
B.prototype.get = function () { return this.a };
module.exports = B;
