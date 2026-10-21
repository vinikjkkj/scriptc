'use strict';

const Types = require('./types.js');

const names = [];
for (const key in Types) {
  if (typeof Types[key] === 'number') names[Types[key]] = key;
}
console.log(names.join(','));

function isTiny(value, table) {
  return table[value] === 'TINY';
}

function describe(code) {
  return Types[code];
}

console.log(describe(0), describe(1), describe(2), describe(3));
console.log(describe('TINY'), describe('LONG'), describe('NOPE'));
console.log(isTiny(1, Types), isTiny(2, Types));
console.log(Object.keys(Types).join(','));
console.log(Types.SHORT, Types.LONG, Types[2]);
const alias = Types;
console.log(alias.TINY);
