import util from "node:util";
const H = JSON.parse('{"showHidden":true}');
const HC = JSON.parse('{"showHidden":true,"colors":true}');
const HG = JSON.parse('{"showHidden":true,"getters":true}');
const HK = JSON.parse('{"showHidden":true,"compact":true,"breakLength":50}');
const HS = JSON.parse('{"showHidden":true,"sorted":true}');
function show(v) { for (const o of [H, HC, HG, HK, HS]) console.log(util.inspect(v, o)); }
class P { constructor() { this.a = 1; this.b = [1, 2]; } m() {} }
class Q extends P { constructor() { super(); this.c = "c"; } n() {} }
show(new P());
show(new Q());
show([new P()]);
show({ p: new Q(), list: [new P(), new P()] });
const u8 = new Uint8Array([1, 2, 3]);
show(u8);
show(new Uint8Array(0));
show(new Uint8Array(150));
show(u8.subarray(1));
show([u8]);
const w = JSON.parse("0") || Object("ab");
show(w);
/** @type {any} */ const sy = { a: 1 };
const k1 = Symbol("k1"); const k2 = Symbol("k2");
Object.defineProperty(sy, k1, { value: 1, enumerable: false });
sy[k2] = 2;
show(sy);
/** @type {any} */ const acc = {};
Object.defineProperty(acc, "g", { get() { return { x: 1 }; }, set(v) {}, enumerable: false });
Object.defineProperty(acc, "go", { get() { return 4; }, enumerable: false });
acc.vis = 1;
show(acc);
/** @type {any} */ const nested = { outer: { inner: {} } };
Object.defineProperty(nested.outer.inner, "deep", { value: [1, { z: 2 }], enumerable: false });
show(nested);
console.log(util.inspect(nested, { showHidden: true, depth: 0 }));
console.log(util.inspect(JSON.parse('{"a":[1,2],"b":{"c":null}}'), H));
console.log(util.formatWithOptions(H, "%O|%s|%j", { a: [1] }, [1, 2], { k: 1 }));
