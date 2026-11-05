// assert.deepStrictEqual compares the own ENUMERABLE symbol keys of dynamic objects: same set, each pair deep-equal.
const assert = require("node:assert");
const k = Symbol("k"), k2 = Symbol("k");
function mk(v) { const o = JSON.parse('{"a":1}'); if (v !== undefined) o[k] = v; return o; }
function t(f) { try { f(); return "equal"; } catch (e) { return "differ"; } }
console.log(t(() => assert.deepStrictEqual(mk(1), mk(1))), t(() => assert.deepStrictEqual(mk(1), mk(2))), t(() => assert.deepStrictEqual(mk(1), mk())), t(() => assert.deepStrictEqual(mk(), mk())));
const o2 = mk(1); o2[k] = undefined; delete o2[k]; o2[k2] = 1;
console.log(t(() => assert.deepStrictEqual(mk(1), o2)));
