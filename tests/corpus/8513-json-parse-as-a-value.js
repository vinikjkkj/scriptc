// JSON.parse taken as a value (pg-types: allowNull(JSON.parse), register(114, JSON.parse.bind(JSON))):
// the interned one-argument closure; a malformed document still throws a catchable SyntaxError.
'use strict';
function allowNull(fn) { return function (v) { return v === null ? null : fn(v); }; }
var parse = allowNull(JSON.parse);
console.log(JSON.stringify(parse('{"a":[1,2]}')), parse(null));
var bound = JSON.parse.bind(JSON);
console.log(JSON.stringify(bound('[1,"x",null]')));
var table = {};
function register(id, fn) { table[id] = fn; }
register(114, JSON.parse.bind(JSON));
register(3802, JSON.parse.bind(JSON));
console.log(JSON.stringify(table[114]('{"k":true}')), JSON.stringify(table[3802]('7')));
try { table[114]('{bad'); } catch (e) { console.log(e.name); }
