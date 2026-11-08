import util from "node:util";
const mk = (s) => JSON.parse(s);
const desc = (a, b) => (a < b ? 1 : a > b ? -1 : 0);
const len = (a, b) => a.length - b.length;
let calls = 0;
const counting = (a, b) => { calls++; return a < b ? -1 : a > b ? 1 : 0; };
const boolcmp = (a, b) => a > b;
const nanc = (a, b) => NaN;
const strc = (a, b) => "1";
function withSorted(fn) { const o = mk('{"depth":3}'); o.sorted = fn; return o; }
const data = { zeta: 1, alpha: [3, 1, 2], mid: { y: 2, x: 1, longerkey: "v" }, beta: new Map([["b", 1], ["a", 2]]), gamma: new Set([3, 1, 2]) };
function show(v) { for (const f of [true, desc, len, counting, boolcmp, nanc, strc, 0, "x"]) { try { console.log(util.inspect(v, withSorted(f))); } catch (e) { console.log("threw", e.constructor.name, e.message); } } }
show(data);
show([5, 1, 4, 2, 3, 9, 8, 7, 6, 10]);
console.log(util.inspect(data, withSorted(desc)) === util.inspect(data, withSorted(desc)), calls > 0);
const cw = mk('{"colors":true}'); cw.sorted = desc;
console.log(util.inspect({ b: 1, a: "s", c: [2, 1] }, cw));
const throwing = (a, b) => { throw new Error("cmp boom"); };
try { console.log(util.inspect({ a: 1, b: 2 }, withSorted(throwing))); } catch (e) { console.log("caught", e.message); }
console.log(util.inspect({ k: 1 }, withSorted(throwing)).length >= 0);
