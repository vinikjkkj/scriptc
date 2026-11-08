import util from "node:util";
import { EventEmitter } from "node:events";
const H = JSON.parse('{"showHidden":true}');
const HC = JSON.parse('{"showHidden":true,"colors":true}');
const HD = JSON.parse('{"showHidden":true,"depth":0}');
const HK = JSON.parse('{"showHidden":true,"compact":true}');
function show(v) { for (const o of [H, HC, HD, HK]) console.log(util.inspect(v, o)); console.log(util.inspect(v)); }
class EE extends EventEmitter { constructor() { super(); this.q = 1; } m() {} get acc() { return 1; } }
show(JSON.parse("0") || EE);
class Sub { constructor() { this.a = 1; } set w(/** @type {number} */ v) {} get r() { return 1; } set w2(/** @type {number} */ v) {} }
show(new Sub());
const wm = new WeakMap(); const ws = new WeakSet();
show(wm); show(ws);
/** @type {any} */ const k1 = { a: 1 }; wm.set(k1, { v: 2 }); ws.add(k1);
show(wm); show(ws);
show({ w: wm });
show(new Float64Array([1.5, 2]));
show(new Int8Array(3));
show(new Uint16Array(2));
show(new Uint8ClampedArray(1));
show(new Float32Array(7));
show(new Uint32Array(150));
