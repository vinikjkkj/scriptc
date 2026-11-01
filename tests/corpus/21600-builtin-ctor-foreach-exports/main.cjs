'use strict';
const lib = require("./lib.cjs");
// Key order of the identifier-named members (Node's insertion order); the element-named member is checked by presence.
console.log(Object.keys(lib).filter((k) => k !== "unsigned long long").join(","), "unsigned long long" in lib);
console.log(typeof lib.Int8Array, typeof lib.Uint8Array, typeof lib.Float64Array);
const i8 = new Int8Array([1, 2, 3]);
console.log(lib.Int8Array(i8), lib.Uint8Array(new Uint8Array(3)), lib.Float64Array(new Float64Array(2)));
console.log(lib.DOMTimeStamp(7), lib["unsigned long long"](8), typeof lib.DOMTimeStamp);
const ctxOpts = JSON.parse('{"context":"ctx"}');
const cases = [
  () => lib.Int8Array(5),
  () => lib.Float64Array("x", ctxOpts),
  () => lib.Uint8Array({}, {}),
  () => lib.Int8Array(new Int8Array(1), ctxOpts),
];
for (const f of cases) {
  try {
    console.log("ok", f());
  } catch (e) {
    console.log(e.constructor.name, e.message);
  }
}
