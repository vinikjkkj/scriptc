// a.js REPLACES its export object after b's back edge already captured
// the old one. In Node b's `a` names the empty pre-replacement object
// forever, so `b.readTag()` is `undefined` even though the read sits in a
// function body and runs long after both modules initialized. No
// position rule can rescue this one — the alias lowering names a's
// declaration and would answer 'A-final' — so the whole edge keeps the
// fence.
'use strict';
const a = require('./a.js');
const b = require('./b.js');
console.log('b.readTag() ' + b.readTag());
console.log('a.tag ' + a.tag);
