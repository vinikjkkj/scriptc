// Symbol-keyed own properties on a checked-dynamic receiver (an Object.create(null) bag): store, read, `in`, hasOwn, delete, defineProperty, getOwnPropertySymbols, and the sloppy-mode quiet answers. Two symbols with one description are two keys; Symbol.for is one key across calls.
const wrapperSymbol = Symbol("wrapper");
const implSymbol = Symbol("impl");
const same = Symbol("impl");
const reg = Symbol.for("[test] registry");
function mk() { return Object.create(null); }
const w = mk();
w[implSymbol] = 1;
w[same] = 2;
w[reg] = 3;
w.str = "s";
console.log(w[implSymbol], w[same], w[reg], w.str);
console.log(implSymbol in w, same in w, Symbol("x") in w, wrapperSymbol in w);
console.log(Object.hasOwn(w, implSymbol), Object.hasOwn(w, wrapperSymbol));
console.log(Object.getOwnPropertySymbols(w).map((s) => String(s)));
console.log(Object.keys(w), JSON.stringify(w));
console.log(delete w[implSymbol], implSymbol in w, same in w);
console.log(Object.getOwnPropertySymbols(w).map((s) => String(s)));
Object.defineProperty(w, wrapperSymbol, { value: 42, configurable: true });
console.log(w[wrapperSymbol], Object.getOwnPropertySymbols(w).map((s) => String(s)));
console.log(Object.keys(w));
w[wrapperSymbol] = 5;
console.log(w[wrapperSymbol]);
Object.defineProperty(w, same, { value: 7 });
w[same] = 9;
console.log(delete w[same], w[same]);
const u = JSON.parse("null");
try { u[implSymbol]; } catch (e) { console.log(e.message); }
try { u[implSymbol] = 1; } catch (e) { console.log(e.message); }
const a = JSON.parse("[1,2]");
a[implSymbol] = "arr";
console.log(a[implSymbol], a.length);
function f() {}
f[implSymbol] = "fn";
console.log(f[implSymbol]);
const s = JSON.parse('"str"'); const n = JSON.parse("5");
console.log(s[implSymbol], n[implSymbol]);
