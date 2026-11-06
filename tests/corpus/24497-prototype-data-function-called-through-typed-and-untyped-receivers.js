// Prototype data that is a function (a generated method, ioredis Commander.prototype.call): called through typed and untyped receivers, a subclass, an own replacement, and an own undefined on a sibling datum.
function gen(name) { return function (x) { return name + ":" + x; }; }
class K { constructor() { this.n = 1; } who() { return this.call; } via() { return this.call("v"); } }
K.prototype.call = gen("call");
K.prototype.label = "kp";
class S extends K { constructor() { super(); this.m = 2; } }
class T { constructor() { this.t = 1; } }
T.prototype.label = "tp";
const tt = new T(), tu = new T(); tu.label = undefined; console.log(tt, tu);
function store(o, k, v) { o[k] = v; }
const a = new K(), b = new K(), c = new K(), s = new S();
store(b, "label", "own");
c.label = undefined;
console.log(a.label, b.label, c.label, s.label, a.who() === a.call, a.via(), s.via());
console.log(a.hasOwnProperty("label"), b.hasOwnProperty("label"), c.hasOwnProperty("label"), s.hasOwnProperty("label"));
console.log(s);
b.call = (x) => "mine:" + x;
console.log(b.via(), a.call("direct"), b.call("direct"));
function viaAny(o) { return o.call("any"); }
console.log(viaAny(a), viaAny(b), viaAny(s));
