"use strict";
// util.inspect and the deepStrictEqual failure diff carry enumerable symbol keys of arrays and function values
const assert = require("node:assert");
const k = Symbol("k");
const hid = Symbol("hid");
function mk() { const f = function (x) { return x; }; f[k] = 5; f.tag = "t"; Object.defineProperty(f, hid, { value: 1 }); return f; }
const a = JSON.parse("[1,2]"); a[k] = 1;
const f = mk();
console.log(a, [a], { a });
console.log(f, [f], { f });
const o = JSON.parse('{"a":1}'); o[k] = 1;
const o2 = JSON.parse('{"a":1}'); o2[k] = 2;
const o3 = JSON.parse('{"a":1}');
const a2 = JSON.parse("[1,2]"); a2[k] = 2;
for (const [x, y] of [[o, o2], [o, o3], [a, a2], [a, JSON.parse("[1,2]")]]) {
  try { assert.deepStrictEqual(x, y); console.log("equal"); } catch (e) { console.log(e.message); }
}
