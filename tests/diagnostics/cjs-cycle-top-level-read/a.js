'use strict';
console.log('a start');
const b = require('./b.js');
exports.aye = aye;
function aye(n) { return n <= 0 ? 0 : b.bee(n - 1) + 1; }
console.log('a end typeof b.bee ' + typeof b.bee);
