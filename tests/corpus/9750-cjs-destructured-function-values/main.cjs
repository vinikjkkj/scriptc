// Functions bound by a destructuring require (from a function-valued module), read as values and called.
const { calc, twice } = require('./fmod.cjs');
const plusOne = require('./fmod.cjs');
const table = { calc: calc, twice };
console.log(calc(4), twice(5), table.calc(2), table.twice === twice, typeof calc, plusOne(1));
const alias = calc;
console.log(alias(10), alias === calc, [calc, twice].map((f) => f(3)).join(','));
