'use strict';

const {
  Events: { add, remove, limit }
} = require('./lib');
const { Util: { shout, Deep: { sum, label } }, version } = require('./lib');
const { Events: { add: addAgain } } = require('./lib');

console.log(add('open', 'h1'));
console.log(remove('close'));
console.log(limit, version);
console.log(shout('hi'));
console.log(sum(2, 3), label);
console.log(addAgain('x', 'y'));
