// node:util/types isDate/isMap/isSet answer by kind (tag test on untyped values, constant on typed). Refused SC2020 before.
const { isDate } = require('util/types');
const types = require('node:util/types');
const { isMap, isSet } = types;
function f(v) { return [isDate(v), isMap(v), isSet(v)]; }
console.log(f(new Date(5)), f(new Map()), f(new Set()), f({}), f('s'), f(3), f(null), f([1]));
function g(v) { if (typeof v === 'object' && isDate(v)) { return v.getTime(); } return -1; }
console.log(g(new Date(7)), g({}), g(undefined));
const d = new Date(1), m = new Map([[1, 2]]);
console.log(isDate(d), isDate(m), isMap(m), isSet(m), isDate(1), isDate('x'));
