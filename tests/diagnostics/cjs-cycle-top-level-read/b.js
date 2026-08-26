'use strict';
console.log('b start');
const a = require('./a.js');
exports.bee = bee;
function bee(n) { return n <= 0 ? 0 : a.aye(n - 1) + 1; }
console.log('b end typeof a.aye ' + typeof a.aye);
