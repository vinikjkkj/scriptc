// A proxy trap for a symbol-keyed access receives the symbol itself (typeof 'symbol', the registry symbol equal to Symbol.for), and its answer is the operation's answer.
"use strict";
const k = Symbol("k"), kr = Symbol.for("reg"), other = Symbol("other");
function mk() { return JSON.parse('{"a":1}'); }
function put(o, key, v) { o[key] = v; }
function get(o, key) { return o[key]; }
const log = [];
const show = (key) => typeof key === "symbol" ? "sym:" + key.toString() + ":" + (key === k) + ":" + (key === kr) : "str:" + String(key);
const h = {
  get(t, key, r) { log.push("get " + show(key) + " " + (r === p)); return typeof key === "symbol" ? 42 : t[key]; },
  set(t, key, v, r) { log.push("set " + show(key) + " " + v); return key !== other; },
  has(t, key) { log.push("has " + show(key)); return key === k; },
  deleteProperty(t, key) { log.push("del " + show(key)); return key !== other; },
  defineProperty(t, key, d) { log.push("def " + show(key) + " " + d.value); return key !== other; },
  getOwnPropertyDescriptor(t, key) { log.push("gopd " + show(key)); return key === k ? { value: 1, enumerable: true, configurable: true } : undefined; },
  ownKeys(t) { log.push("ownKeys"); return ["a", k, kr]; },
};
const p = new Proxy(mk(), h);
console.log(get(p, k), get(p, kr));
put(p, k, 7); put(p, kr, 8);
try { put(p, other, 9); } catch (e) { console.log(e.constructor.name + ": " + e.message); }
console.log(k in p, other in p, kr in p);
console.log(delete p[k]);
try { delete p[other]; } catch (e) { console.log(e.constructor.name + ": " + e.message); }
Object.defineProperty(p, k, { value: 5 });
try { Object.defineProperty(p, other, { value: 6 }); } catch (e) { console.log(e.constructor.name + ": " + e.message); }
console.log(Object.hasOwn(p, k), Object.hasOwn(p, kr));
console.log(Object.getOwnPropertySymbols(p).map((s) => s.toString()));
console.log(log.join("\n"));
const p2 = new Proxy(mk(), { getOwnPropertyDescriptor(t, key) { return key === k ? { value: 1, enumerable: false, configurable: true } : undefined; } });
console.log(Object.hasOwn(p2, k), Object.hasOwn(p2, kr));
const cp = { ...p }; console.log(Object.getOwnPropertySymbols(cp).length, get(cp, k));
const cp2 = Object.assign({}, p2); console.log(Object.getOwnPropertySymbols(cp2).length);
