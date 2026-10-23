// A builtin module function taken by name and kept in an untyped variable:
// `typeof` says function and the call answers like the call form (the value
// used to be the string token '[builtin net.isIP]' and the call threw).
const { isIP, isIPv6 } = require('net');
const { dirname, extname } = require('path');
let f;
f = isIP;
console.log(typeof f);
console.log(f('1.2.3.4'), f('::1'), f('nope'));
let g, h, k;
g = isIPv6;
h = dirname;
k = extname;
console.log(typeof g, typeof h, typeof k);
console.log(g('::1'), g('1.2.3.4'), h('/a/b/c.txt'), k('/a/b/c.txt'));
let again;
again = isIP;
console.log(typeof again, again('9.9.9.9'));
