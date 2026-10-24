'use strict';
// `[].slice.call(arguments)` and `Array.prototype.slice.call(arguments, n)`: the arguments pack
// read through slice, indexOf, lastIndexOf, join and includes.
function pack() { const a = [].slice.call(arguments); a.unshift('x'); return a; }
console.log(pack(1, 'b'), pack());
const fwd = function () { return Array.prototype.slice.call(arguments, 1).length; };
console.log(fwd(1, 2, 3), fwd(), fwd(9));
function idx() { return [].indexOf.call(arguments, 2) + [].lastIndexOf.call(arguments, 2) + [].join.call(arguments, '+'); }
console.log(idx(1, 2, 3, 2));
function incl(a, b) { return [].includes.call(arguments, b) + ':' + Array.prototype.slice.call(arguments, 1, 2); }
console.log(incl(1, 2, 3), incl(5, 6));
