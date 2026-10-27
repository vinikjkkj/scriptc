'use strict';
const f = require('./plugin.cjs');
console.log(f({ x: 1 })({ connection: 2 }), f({})({ connection: 5 }));
