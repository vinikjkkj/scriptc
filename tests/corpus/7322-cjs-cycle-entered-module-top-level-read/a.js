'use strict';
console.log('a start');
const b = require('./b.js');
exports.fromB = b.bTag;
console.log('a end fromB=' + exports.fromB);
