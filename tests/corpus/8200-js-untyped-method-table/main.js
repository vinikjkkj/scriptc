'use strict';

const { Tools, Consts, plain } = require('./lib');

console.log(Tools.greet('ws'));
console.log(Tools.twice(21));
console.log(Tools.join('a', 'b'));
const f = Tools.twice;
console.log(f(4));
console.log(plain(1), Consts.LIMIT, Consts.NAME);

const lib = require('./lib');
console.log(lib.Tools.greet('again'));
