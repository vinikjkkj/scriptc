// An untyped key that holds a symbol is a symbol key, not its string: two symbols with one description stay apart, the registry is shared, and a string spelling of the description is its own key.
"use strict";
const a = Symbol("x"), b = Symbol("x"), r = Symbol.for("reg");
function put(o, k, v) { o[k] = v; }
function get(o, k) { return o[k]; }
function has(o, k) { return k in o; }
function own(o, k) { return Object.hasOwn(o, k); }
function del(o, k) { return delete o[k]; }
function def(o, k, v) { Object.defineProperty(o, k, { value: v, configurable: true }); }
const o = JSON.parse('{"Symbol(x)":"string key"}');
put(o, a, 1); put(o, b, 2); put(o, r, 3); put(o, "Symbol(x)", "overwritten"); put(o, 7, "num");
console.log(get(o, a), get(o, b), get(o, r), get(o, "Symbol(x)"), get(o, 7), get(o, "7"));
console.log(has(o, a), has(o, b), has(o, Symbol("x")), has(o, "Symbol(x)"), own(o, r), own(o, Symbol.for("reg")), own(o, "nope"));
def(o, Symbol.for("d"), 9);
console.log(Object.getOwnPropertySymbols(o).length, Object.keys(o), get(o, Symbol.for("d")));
console.log(del(o, a), has(o, a), has(o, b), del(o, "Symbol(x)"), Object.keys(o));
const ks = [a, "z", b];
for (const k of ks) put(o, k, String(typeof k));
console.log(ks.map((k) => get(o, k)), Object.getOwnPropertySymbols(o).length);
