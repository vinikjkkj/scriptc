// showHidden interleaves non-enumerable accessors with members by creation position; deleting a member shifts them.
import * as util from "node:util";
const o: any = { m0: 0, m1: 1 };
Object.defineProperty(o, "h_a", { get: function () { return 1; }, configurable: true });
o.m2 = 2;
Object.defineProperty(o, "h_b", { get: function () { return 2; }, configurable: true });
o.m3 = 3;
console.log(util.inspect(o, { showHidden: true }));
delete o.m1;
console.log(util.inspect(o, { showHidden: true }));
delete o.m0;
console.log(util.inspect(o, { showHidden: true }));
Object.defineProperty(o, "h_c", { get: function () { return 3; }, configurable: true });
console.log(util.inspect(o, { showHidden: true }));
// a position past the shared small-integer range: 1100 members, then an accessor, then a few deletes
const big: any = {};
for (let i = 0; i < 1100; i++) big["k" + i] = i;
Object.defineProperty(big, "late", { get: function () { return "late"; }, configurable: true });
big.tail = 1;
const text1 = util.inspect(big, { showHidden: true, maxArrayLength: 0, breakLength: Infinity, depth: 0 });
console.log(text1.length, text1.indexOf("[late]") > text1.indexOf("k1099:"), text1.indexOf("[late]") < text1.indexOf("tail:"));
delete big.k5; delete big.k6;
const text2 = util.inspect(big, { showHidden: true, breakLength: Infinity, depth: 0 });
console.log(text2.length, text2.indexOf("[late]") > text2.indexOf("k1099:"), text2.indexOf("[late]") < text2.indexOf("tail:"), big.late);
