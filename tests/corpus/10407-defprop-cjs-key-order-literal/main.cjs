const d = require('./dep.cjs');
console.log(Object.keys(d).join(','));
console.log(JSON.stringify(d));
for (const k in d) console.log('key', k, d[k]);
