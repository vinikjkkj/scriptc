// a.js reads a cycle-crossing binding at its TOP LEVEL (`b.bTag`) and is
// still admitted, because a.js is the module the walk entered the cluster
// through: a CommonJS require is a STATEMENT that returns only once the
// target's body ran, so b is finished by the time line 4 executes. The
// same read in b.js would be a back-edge read and keeps the fence
// (tests/diagnostics/cjs-cycle-top-level-read). The transcript would
// print `undefined` for fromB if the order were wrong.
'use strict';
const a = require('./a.js');
const b = require('./b.js');
console.log('a.fromB ' + a.fromB);
console.log('b.viaA() ' + b.viaA());
