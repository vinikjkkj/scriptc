import util from "node:util";
const T = JSON.parse('{"compact":true}');
const TC = JSON.parse('{"compact":true,"colors":true}');
const T3 = JSON.parse('{"compact":true,"breakLength":40}');
class Pt { constructor(x, y) { this.x = x; this.y = y; this.label = "p".repeat(30); } }
class Node2 { constructor() { this.kids = []; this.name = "n"; } }
const a = new Pt(1, 2);
const n = new Node2(); n.kids.push(n); n.kids.push(new Pt(3, 4));
const vals = [a, n, new Date(0), /re+/gi, new Map([["k", "v"]]), new Set(["a", "b"]), new Uint8Array([1, 2, 3]), Symbol("s"), 12n, [1, [2, [3, [4]]]], { a: { b: { c: { d: {} } } } }, { s: Symbol("q") }, "x".repeat(90), ["y".repeat(40), "z".repeat(40)]];
function show(v) { console.log(util.inspect(v, T)); console.log(util.inspect(v, TC)); console.log(util.inspect(v, T3)); }
for (const v of vals) show(v);
const o = { f() {}, g: () => 1, h: function named() {}, cls: class K {} };
show(o);
console.log(util.inspect({ long: { alpha: "a".repeat(50), beta: "b".repeat(50), gamma: { delta: "d".repeat(70) } } }, T));
console.log(util.inspect({ long: { alpha: "a".repeat(50), beta: "b".repeat(50), gamma: { delta: "d".repeat(70) } } }, TC));
const cyc = { arr: [1, 2], me: null }; cyc.me = cyc; cyc.arr.push(cyc);
console.log(util.inspect(cyc, T));
console.log(util.inspect(cyc, TC));
console.log(util.formatWithOptions(T, "%s %O %j", "a", { x: 1 }, { y: 2 }));
