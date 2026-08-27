'use strict';
console.log('b start');
const a = require('./a.js');
exports.bName = function () { return 'b'; };
exports.viaA = function () { return a.aName(); };
console.log('b end');
