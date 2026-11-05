// The deepStrictEqual failure message prints the symbol-keyed lines and the "same structure" notice does not fire for objects that differ only in them.
const assert = require("node:assert");
const k = Symbol("k");
const a = JSON.parse('{"a":1}'); a[k] = 1;
const b = JSON.parse('{"a":1}'); b[k] = 2;
try { assert.deepStrictEqual(a, b); } catch (e) { console.log(e.message); }
const c = JSON.parse('{"a":1}');
try { assert.deepStrictEqual(a, c); } catch (e) { console.log(e.message); }
