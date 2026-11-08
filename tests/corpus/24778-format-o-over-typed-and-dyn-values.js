import util from "node:util";
function f(a, b) { "use strict"; return a; }
const arr = [1, 2, 3];
const rec = { name: "n", list: [1, 2], nested: { deep: [3] } };
console.log("%o", arr);
console.log("%o", rec);
console.log("%o|%O", rec, rec);
console.log(util.format("%o", f));
console.log(util.format("%o and %s", [4, 5], "x"));
console.log("%o", [[1, [2, [3, [4, [5]]]]]]);
console.log(util.format("%o", "str"), util.format("%o", 42));
const mixed = { fn: f, list: [f] };
console.log("%o", mixed);
console.log(util.formatWithOptions({ colors: true }, "%o", arr));
console.log(util.formatWithOptions({ compact: true }, "%o", rec));
function viaAny(fmt, v) { return util.format(fmt, v); }
console.log(viaAny("%o", { z: [1] }));
console.log(viaAny("%o", [f]));
console.log("%o", new Map([["k", [1]]]));
