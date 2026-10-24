// `===` between a dynamic value and a function: the closure boxes by reference
// and a function box compares by the closure it carries. It was refused
// ("operators on 'unknown' values").
function g(a) { return a; }
function h(a, b) { return b; }
const rec = { first: g, second: h };
console.log(rec.first === g, rec.first !== g, rec.second === g, rec.second === h);
const list = [g];
console.log(list[0] === g, list[0] === h);
function pick(table, name) { return table[name]; }
console.log(pick(rec, 'first') === g, pick(rec, 'second') === g);
