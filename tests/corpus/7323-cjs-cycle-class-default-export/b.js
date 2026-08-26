'use strict';
console.log('b start');
const a_1 = require('./a.js');
class B { viaA() { return new a_1.default().hello(); } }
exports.default = B;
console.log('b end');
