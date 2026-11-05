"use strict";
// Symbol keys spelled four ways: an object-literal member, a call result, an array element, Symbol.for; compound assignment and ++ go through the same read-modify-write.
const utils = { implSymbol: Symbol("impl"), wrapperSymbol: Symbol.for("wrapper") };
const syms = [Symbol("a"), Symbol("b")];
function pick(n) { return syms[n]; }
function mk() { return Object.create(null); }
const o = mk();
o[utils.implSymbol] = 1;
o[utils.wrapperSymbol] = 2;
o[pick(0)] = 3;
o[syms[1]] = 4;
console.log(o[utils.implSymbol], o[utils.wrapperSymbol], o[pick(0)], o[syms[1]], o[Symbol.for("wrapper")]);
console.log(Object.getOwnPropertySymbols(o).length, utils.implSymbol in o, Object.hasOwn(o, pick(1)));
const key = syms[0];
o[key] += 10;
o[key]++;
console.log(o[key]);
let t = o;
t[utils.implSymbol] = t[utils.implSymbol] + 1;
console.log(o[utils.implSymbol]);
