import util from "node:util";
const on = JSON.parse('{"colors":true}');
class Point { constructor(x, y) { this.x = x; this.y = y; } get len() { return 1; } }
class Child extends Point { constructor() { super(1, 2); this.tag = "c"; } }
function plain(a) { return a; }
const arrow = (q) => q;
const sym = Symbol("tag");
const m = new Map([["k", 1], [2, { deep: [1, 2] }]]);
const st = new Set([1, "two", null]);
class Cust { [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) { return options.stylize("custom!", "special") + " " + inspect({ n: 1 }, options); } }
const things = {
  date: new Date(0), sym, plain, arrow, cls: Point, child: new Child(), pt: new Point(3, 4), map: m, set: st,
  u8: new Uint8Array([1, 2, 3]), wrapS: Object("s"), wrapN: Object(5), wrapB: Object(false), emptyMap: new Map(), emptySet: new Set(), big: 5n,
  wm: new WeakMap(), nested: { a: { b: { c: { d: 1 } } } }, custom: new Cust(), buf: Buffer.from("ab"),
};
for (const [k, v] of Object.entries(things)) console.log(k, util.inspect(v, on));
console.log(util.inspect(things, on));
console.log(util.formatWithOptions(on, "%s %O", sym, things.pt), util.inspect(new Date(NaN), on));
console.log(util.inspect([sym, plain, new Date(1)], JSON.parse('{"colors":true,"depth":0}')));
