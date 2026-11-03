// ioredis Script shape: an evaluated class extending a program class with implicit-any methods; the prototype carries them.
function anyv(x) { return x; }
class Command { constructor(name, args) { this.name = name; this.args = args; } toWritable(s) { return this.name + ":" + s; } }
const mk = (lua) => class Custom extends Command { toWritable(socket) { return "c" + super.toWritable(socket) + lua; } generic(a, b) { return [a, b]; } };
const h = {}; h.C = mk("L");
const C = anyv(h.C);
const c = new C("n", []);
console.log(C.prototype.toWritable.call(c, "s"), C.prototype.generic.call(c, 1, "x"), Object.getOwnPropertyNames(C.prototype));
console.log(c.toWritable("z") === C.prototype.toWritable.call(c, "z"));
