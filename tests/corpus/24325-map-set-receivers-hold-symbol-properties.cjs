// A Map or Set is an object: a symbol-keyed expando on it is kept per object identity, listed, deleted and printed after the entries.
"use strict";
const kA = Symbol("a"), kB = Symbol.for("b");
function put(o, v) { o[kA] = v; o[kB] = v + 1; return o; }
function look(o) { return [o[kA], o[kB], kA in o, Object.hasOwn(o, kB), Object.getOwnPropertySymbols(o).length, Reflect.ownKeys(o).length]; }
const m = put(new Map([[1, 2]]), 7);
const s = put(new Set([3]), 9);
console.log(look(m), look(s), look(new Map()), look(new Set()));
console.log(m.size, s.size, m.get(1), s.has(3));
delete m[kA];
console.log(look(m));
console.log(m, s);
