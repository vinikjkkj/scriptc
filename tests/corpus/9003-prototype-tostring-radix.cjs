'use strict';
// A prototype-built object's toString(radix) is its own method (the radix is an extra argument it ignores), not Number.prototype.toString.
function Long(low, high) { this.low = low | 0; this.high = high | 0; }
Long.prototype.toString = function () { return 'L(' + this.low + ',' + this.high + ')'; };
const c = new Long(5, 6);
console.log(c.toString(10), c.toString(16), c.high);
const d = require('./9003-prototype-tostring-radix-modules/long.cjs');
const e = new d(7, 8);
console.log(e.toString(2), String(e));
const n = 255;
const anyN = n;
console.log(anyN.toString(16), anyN.toString(2), (anyN + 1).toString(8));
const obj = { toString(r) { return 'obj' + r; } };
console.log(obj.toString(3));
