'use strict';
console.log('a start');
exports.aName = function () { return 'a'; };
const b = require('./b.js');
exports.viaB = function () { return b.bName(); };
console.log('a end');
