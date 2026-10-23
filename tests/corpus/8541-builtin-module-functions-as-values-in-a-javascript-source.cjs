const net = require('net');
const path = require('path');
const { isIP, isIPv4, isIPv6 } = net;
const { dirname, extname, isAbsolute, normalize, relative } = path;
let f;
f = isIP;
console.log(typeof f, f('10.0.0.1'), f('::1'), f('nope'));
const table = { v4: isIPv4, v6: isIPv6, ip: net.isIP };
console.log(table.v4('1.2.3.4'), table.v6('1.2.3.4'), table.v6('::'), table.ip('fe80::1%lo0'));
const g = isIP;
console.log(g === isIP, g === net.isIP, isIPv4 === isIPv4, isIPv4 === isIPv6);
const picks = [dirname, extname, normalize];
for (const p of picks) console.log(typeof p, p('/a/b/../c/file.txt'));
console.log(dirname === path.dirname, isAbsolute('/x'), isAbsolute === path.isAbsolute, relative('/a/b', '/a/c/d'));
function apply(fn, a) { return fn(a); }
console.log(apply(isIP, '8.8.8.8'), apply(dirname, '/p/q/r'));
