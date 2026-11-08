import util from "node:util";
const H = JSON.parse('{"showHidden":true}');
const HC = JSON.parse('{"showHidden":true,"colors":true}');
const HG = JSON.parse('{"showHidden":true,"getters":true}');
const HGG = JSON.parse('{"showHidden":true,"getters":"get"}');
const HGS = JSON.parse('{"showHidden":true,"getters":"set"}');
const HD = JSON.parse('{"showHidden":true,"depth":0}');
const HK = JSON.parse('{"showHidden":true,"compact":true}');
function show(v) { for (const o of [H, HC, HG, HGG, HGS, HD, HK]) console.log(util.inspect(v, o)); console.log(util.inspect(v)); }
class A { constructor() { this.x = 1; } get g() { return { k: 1 }; } get both() { return 5; } set both(v) {} m() {} }
class B extends A { constructor() { super(); this.y = 2; } get gb() { return "s"; } }
class C extends B { get gc() { return 1; } }
class D extends C { get gd() { return 2; } }
class E { get only() { return 1; } }
class T { get arr() { return [1, 2]; } }
show(new A());
show(new B());
show(new C());
show(new D());
show(new E());
show(new T());
show([new A()]);
show({ inner: new B(), plain: 1 });
