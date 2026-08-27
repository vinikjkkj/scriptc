// The CommonJS cycle every package is built from: the back edge binds a
// name, and every read of it sits inside a function body. Those run after
// the whole graph initialized, where the alias lowering and Node's
// exports object hold the same members. The transcript pins the
// EVALUATION ORDER too (a start / b start / b end / a end): b's body runs
// to completion inside a's require, exactly as the guarded %init calls
// reproduce it.
'use strict';
const a = require('./a.js');
const b = require('./b.js');
console.log('a.viaB()', a.viaB());
console.log('b.viaA()', b.viaA());
console.log('typeof a.aName', typeof a.aName);
