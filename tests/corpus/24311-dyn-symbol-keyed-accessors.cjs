// Symbol-keyed ACCESSOR properties on checked-dynamic objects: defineProperty with get/set (inherited through Object.create, `this` the receiver), getter-only strict-mode errors, conversion between data and accessor, Object.hasOwnProperty over a symbol, and the redefinition errors.
"use strict";
const kv = Symbol("value");
const kLen = Symbol("len");
function mk() { return Object.create(null); }
const proto = mk();
let log = [];
Object.defineProperty(proto, kLen, {
  get() { log.push("get"); return this.items ? this.items.length : -1; },
  set(v) { log.push("set " + v); this.items = new Array(v).fill(0); },
  enumerable: true,
  configurable: true,
});
const child = Object.create(proto);
child.items = [1, 2, 3];
console.log(child[kLen], log);
child[kLen] = 2;
console.log(child.items, child[kLen], log);
console.log(Object.hasOwn(child, kLen), Object.hasOwn(proto, kLen), kLen in child);
const o = mk();
Object.defineProperty(o, kv, { get() { return 42; }, enumerable: true });
console.log(o[kv], o);
try { o[kv] = 1; } catch (e) { console.log(e.constructor.name + ": " + e.message); }
const copy = { ...o };
console.log(Object.getOwnPropertySymbols(copy).length, copy[kv]);
const q = JSON.parse("{}");
q[kv] = 1;
console.log(Object.prototype.hasOwnProperty.call(o, kv), q.hasOwnProperty(kv), q.hasOwnProperty(kLen));
try { Object.defineProperty(o, kv, { value: 1 }); } catch (e) { console.log(e.message); }
const p = mk();
Object.defineProperty(p, kv, { value: 1, configurable: true });
Object.defineProperty(p, kv, { get() { return 2; }, configurable: true });
console.log(p[kv]);
try { Object.defineProperty(p, kv, { get() { return 2; }, value: 3 }); } catch (e) { console.log(e.message); }
try { Object.defineProperty(p, kLen, { get: 5 }); } catch (e) { console.log(e.message); }
