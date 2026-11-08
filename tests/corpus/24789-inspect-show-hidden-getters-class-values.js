import util from "node:util";
const HG = JSON.parse('{"showHidden":true,"getters":true}');
const HGG = JSON.parse('{"showHidden":true,"getters":"get"}');
const HGS = JSON.parse('{"showHidden":true,"getters":"set"}');
const HGC = JSON.parse('{"showHidden":true,"getters":true,"colors":true}');
const HG1 = JSON.parse('{"showHidden":true,"getters":true,"depth":1}');
const HG0 = JSON.parse('{"showHidden":true,"getters":true,"depth":0}');
const HGK = JSON.parse('{"showHidden":true,"getters":true,"compact":true}');
function show(v) { for (const o of [HG, HGG, HGS, HGC, HG1, HG0, HGK]) console.log(util.inspect(v, o)); }
class P1 {
  get c() { return 42; }
  get o() { return { k: 1, n: { a: [1, 2] } }; }
  get s() { return "str"; }
  get both() { return 1; }
  set both(v) {}
  get t() { return true; }
  get nl() { return null; }
  get big() { return 10n; }
  get arr() { return [1, "x", { y: 2 }]; }
  static get sg() { return { a: 1, b: [1, 2, 3] }; }
  static get sh() { return "h"; }
  static sf = 1;
}
class P2 extends P1 { get d() { return { dd: 4 }; } get e() { return "e"; } }
class P3 extends P2 { get f() { return 3; } }
class P4 extends P3 { get g() { return 4; } }
show(JSON.parse("0") || P1);
show(JSON.parse("0") || P2);
show(JSON.parse("0") || P3);
show(JSON.parse("0") || P4);
show([JSON.parse("0") || P1]);
show({ x: { y: JSON.parse("0") || P2 } });
function mkk(n) { return class Ev { get ek() { return 5; } get both() { return 1; } set both(v) {} m() { return n; } }; }
show(mkk(1));
show(new P2());
