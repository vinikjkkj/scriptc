// The shape tsc emits for `export default class` on both sides of a
// cycle, and the one ioredis's Redis.js <-> cluster/index.js is: the back
// edge's `a_1.default` is read inside a METHOD, and the forward edge's
// `b_1.default` at the top level after its own require. This is the exact
// pair the SC1016 require()-edge fence used to refuse wholesale.
'use strict';
const a = require('./a.js');
const B = a.Cluster;
console.log('B.viaA ' + new B().viaA());
console.log('ctor ' + B.name);
