'use strict';
console.log('b start');
const a = require('./a.js');
exports.readTag = function () { return String(a.tag); };
console.log('b end');
