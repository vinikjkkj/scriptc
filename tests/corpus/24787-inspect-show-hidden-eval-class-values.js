import util from "node:util";
import { EventEmitter } from "node:events";
const H = JSON.parse('{"showHidden":true}');
const HC = JSON.parse('{"showHidden":true,"colors":true}');
const HD = JSON.parse('{"showHidden":true,"depth":0}');
const HK = JSON.parse('{"showHidden":true,"compact":true}');
function show(v) { for (const o of [H, HC, HD, HK]) console.log(util.inspect(v, o)); console.log(util.inspect(v)); }
class K0 { bm() {} get bg() { return 1; } static bs = 1; }
function mk(n) {
  return class Inner { constructor(a, b) { this.a = a; } m(x) { return n; } get g() { return 8; } get both() { return 1; } set both(v) {} static sm(a, b) { return n; } static s = 2; };
}
function mkDerived(n) {
  return class Derived extends K0 { dm() { return n; } get dg() { return 9; } static ds = 5; };
}
function mkEE(n) {
  return class EEv extends EventEmitter { constructor() { super(); this.n = n; } m() { return n; } get g() { return 10; } static z = 1; };
}
function mkEmpty() { return class {}; }
const K = mk(7);
show(K);
show(mkDerived(1));
show(mkEE(1));
show(mkEmpty());
show([K]);
show({ k: K });
show(new K(1, 2));
