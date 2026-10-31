// Symbol keys are not string keys: Object.keys, JSON.stringify, for-in and
// the string-keyed reads see only the string members, while a symbol-keyed
// member still prints in util.inspect's order.
const s = Symbol("hidden");
const o = { a: 1, [s]: 2, b: 3 };
let seen = "";
for (const key in o) seen += key;
console.log(seen, o.a, o.b, Object.keys(o).length, JSON.stringify(o));
console.log(o);
