const direct = require('./impl.js');
const via = require('./passthrough.js');
const lit = require('./literal-barrel.js');
const deep = require('./deep.js');

console.log(direct.bump(), via.bump(), direct.read(), via.read(), deep.read());
console.log(via.label, deep.label);
console.log(lit.twice(lit.base), lit.name);
