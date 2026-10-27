'use strict';
const P = require('./packets.cjs');
console.log(typeof P.A, typeof P.B);
console.log(new P.A().n, new P.B().n, P.marker);
