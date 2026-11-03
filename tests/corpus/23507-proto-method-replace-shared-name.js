// Two unrelated classes declare the same method name; only the one the program writes is replaced. Methods with untyped parameters, rest and defaults.
class Left { constructor() { this.s = "L"; } show(a, b) { return this.s + ":" + a + ":" + b; } }
class Right { constructor() { this.s = "R"; } show(a, b) { return this.s + ":" + a + ":" + b; } }
const l = new Left(), r = new Right();
console.log(l.show(1, 2), r.show(3, 4));
Left.prototype.show = function (a, b) { return "[" + this.s + "|" + a + "|" + b + "]"; };
console.log(l.show(1, 2), r.show(3, 4), new Left().show(5), new Right().show(6, 7));
class Opt { constructor() { this.t = 1; } go(x = 5) { return this.t + x; } }
const o = new Opt();
console.log(o.go(), o.go(2));
Opt.prototype.go = function (x = 7) { return this.t + x * 10; };
console.log(o.go(), o.go(2), new Opt().go());
