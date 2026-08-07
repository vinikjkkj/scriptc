// THE WHOLE-EXPORT ROOT. `module.exports = <identifier>` over a root the
// alias path cannot carry — a `var`, or a binding the module keeps to
// itself — is the commonest generated-CommonJS export there is, and the
// statement had no lowering: in the comma spelling it took the generic
// "assignment to non-variables" and aborted the module init at its very last
// operand, and in the statement spelling it fenced the root as a mutable
// binding exported by reference. Node's answer is a snapshot — module.exports
// holds the value the root had AT that statement — so the export gets storage
// of its own and the statement is the assignment that fills it.
'use strict';
const bundled = require('./bundled.cjs');
const plain = require('./plain.cjs');

console.log('A', bundled.wire.tag);
console.log('B', bundled.wire.twice(21));
console.log('C', bundled.late);
console.log('D', plain.parts.tag, plain.parts.n);
