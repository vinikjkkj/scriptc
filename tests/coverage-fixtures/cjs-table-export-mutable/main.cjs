'use strict';
const a = require('./later.cjs');
const b = require('./fnwrite.cjs');
console.log(a.n);
console.log(b.n);
b.bump();
console.log(b.n);
