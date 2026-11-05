// A symbol-keyed access through a Proxy with no trap for it reaches the target; a revoked proxy throws V8's TypeError.
"use strict";
const k = Symbol("k");
function mkTarget() { return JSON.parse('{"a":1}'); }
function put(o, v) { o[k] = v; }
function get(o) { return o[k]; }
const t = mkTarget();
const p = new Proxy(t, {});
put(p, 3);
console.log(get(p), get(t), k in p, Object.getOwnPropertySymbols(p).length, delete p[k], get(t));
const q = new Proxy(mkTarget(), { get(target, key) { return "trap"; } });
console.log(q.a);
const r = Proxy.revocable(mkTarget(), {});
r.revoke();
try { get(r.proxy); } catch (e) { console.log(e.constructor.name + ": " + e.message); }
