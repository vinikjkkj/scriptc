// `C.prototype.b = C.prototype.a` (ioredis Commander.prototype.send_command = Commander.prototype.call): the alias is data, and holds
// the value `a` had at the assignment; a later write to `a` does not follow.
function gen(name) { return function (x) { return name + ":" + x; }; }
class C { constructor() { this.n = 1; } }
C.prototype.a = gen("first");
C.prototype.b = C.prototype.a;
C.prototype.a = gen("second");
function call(o, k, x) { return o[k](x); }
const c = new C();
console.log(call(c, "a", 1), call(c, "b", 2));
class D extends C {}
const d = new D();
d.b = gen("own");
console.log(call(d, "a", 3), call(d, "b", 4), call(c, "b", 5), c.b === C.prototype.b);
function show(o) { return Object.hasOwnProperty.call(o, "b") + "/" + (o.b !== undefined); }
console.log(show(c), show(d));
