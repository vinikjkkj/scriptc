import util from "node:util";
const H = JSON.parse('{"showHidden":true}');
const HC = JSON.parse('{"showHidden":true,"colors":true}');
const HD = JSON.parse('{"showHidden":true,"depth":0}');
const HK = JSON.parse('{"showHidden":true,"compact":true}');
function show(v) { for (const o of [H, HC, HD, HK]) console.log(util.inspect(v, o)); console.log(util.inspect(v)); }
class K0 {}
class K1 { constructor(a, b) { this.a = a; } m(x) {} n() {} get g() { return 1; } static sm(a, b, c) {} static s = 2; static t = "t"; }
class K2 extends K1 { constructor() { super(1, 2); } o() {} get h() { return 2; } set h(v) {} static sm2() {} }
class K3 extends K2 { get k3() { return 3; } }
class SO { set only(/** @type {number} */ v) {} get both() { return 1; } set both(v) {} }
class SG { static get sg() { return 5; } static m() {} }
show(JSON.parse("0") || K0);
show(JSON.parse("0") || K1);
show(JSON.parse("0") || K2);
show(JSON.parse("0") || K3);
show(JSON.parse("0") || SG);
show([JSON.parse("0") || K1]);
show({ nested: { cls: JSON.parse("0") || K2 } });
show(new SO());
show(new K3());
