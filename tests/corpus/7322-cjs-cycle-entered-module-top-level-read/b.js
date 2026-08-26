'use strict';
console.log('b start');
const a = require('./a.js');
exports.bTag = 'B';
exports.viaA = function () { return String(a.fromB); };
console.log('b end');
