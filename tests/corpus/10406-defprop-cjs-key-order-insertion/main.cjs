// Object.keys, for-in and JSON.stringify of a require() value follow the
// module.exports object's INSERTION order (Node), not the sorted name order.
const d = require('./dep.cjs');
console.log(Object.keys(d).join(','));
console.log(JSON.stringify(d));
for (const k in d) console.log('key', k);
console.log(d.zeta + d.alpha + d.beta, d.zz());
