const dbg = require('./node.cjs');
const d = dbg('ns1');
console.log(d.ns, d.n, dbg.log(1, 2), dbg.colors.join(','), dbg.readLater());
