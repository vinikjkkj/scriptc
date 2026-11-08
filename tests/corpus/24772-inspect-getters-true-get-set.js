import util from "node:util";
const G = JSON.parse('{"getters":true}');
const GG = JSON.parse('{"getters":"get"}');
const GS = JSON.parse('{"getters":"set"}');
const GF = JSON.parse('{"getters":false}');
const GX = JSON.parse('{"getters":"other"}');
const GC = JSON.parse('{"getters":true,"colors":true}');
const GK = JSON.parse('{"getters":true,"compact":true}');
const GD = JSON.parse('{"getters":true,"depth":0}');
function show(v) { for (const o of [G, GG, GS, GF, GX, GC, GK, GD]) console.log(util.inspect(v, o)); console.log(util.inspect(v)); }
const o = {
  get plain() { return 5; },
  get str() { return "text"; },
  get nul() { return null; },
  get und() { return undefined; },
  get obj() { return { a: 1, b: [1, 2] }; },
  get arr() { return [1, 2, 3]; },
  get both() { return 7; },
  /** @param {number} v */ set both(v) {},
  /** @param {number} v */ set only(v) {},
  get big() { return 10n; },
  get bool() { return false; },
  get long() { return "L".repeat(120); },
  get thr() { throw "boom"; },
};
show(o);
show({ outer: { get inner() { return { deep: { x: 1 } }; } } });
const self = { get me() { return this === self ? "same" : "other"; } };
show(self);
const k = { count: 0, get next() { return ++this.count; } };
console.log(util.inspect(k, G), util.inspect(k, G), k.count);
const d = {}; Object.defineProperty(d, "e", { get() { return 3; }, enumerable: true }); d.z = 1;
show(d);
