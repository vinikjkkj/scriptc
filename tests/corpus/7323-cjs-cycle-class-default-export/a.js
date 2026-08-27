'use strict';
console.log('a start');
const b_1 = require('./b.js');
class A { hello() { return 'A.hello'; } }
exports.default = A;
exports.Cluster = b_1.default;
console.log('a end');
