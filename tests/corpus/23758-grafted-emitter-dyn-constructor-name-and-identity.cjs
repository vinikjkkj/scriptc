const { EventEmitter } = require("events");
function applyMixin(derivedConstructor, mixinConstructor) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name));
  });
}
// The graft copies EventEmitter.prototype.constructor over the class's own, so a boxed instance of the class that applied
// it reports EventEmitter (ioredis: `this.redis.constructor.name === "Cluster"` is false for a Cluster), while a subclass
// of it keeps its own `constructor`. The class value compares equal to EventEmitter, to a program class, and to itself.
class Base { constructor() { this.b = 1; } }
class Redis extends Base { constructor() { super(); EventEmitter.call(this); } }
applyMixin(Redis, EventEmitter);
class Cluster extends Base { constructor() { super(); EventEmitter.call(this); this.isCluster = true; } }
applyMixin(Cluster, EventEmitter);
class Sub extends Redis { constructor() { super(); this.s = 1; } }
class Plain { constructor() { EventEmitter.call(this); } }
applyMixin(Plain, EventEmitter);
class Bare extends EventEmitter {}
const v = (x) => x;
function name(x) { return x.constructor.name; }
for (const x of [new Redis(), new Cluster(), new Sub(), new Plain(), new Bare(), new EventEmitter(), new Base()]) {
  console.log(name(v(x)), v(x).constructor === EventEmitter, v(x).constructor === Redis, v(x).constructor === Sub, v(x).constructor !== Bare, v(x) instanceof EventEmitter);
}
function isCluster(redis) { return redis.constructor.name === "Cluster" || redis.isCluster; }
console.log(isCluster(v(new Redis())), isCluster(v(new Cluster())));
// A static member read or call off the class value that EventEmitter's function object does not have is undefined (the
// protobufjs writer's `this.constructor.alloc(n)`), and calling it is Node's TypeError; a subclass's own statics answer.
class Sub2 extends Redis { static alloc(n) { return "sub" + n; } constructor() { super(); this.s = 1; } }
class Writer { finish() { return this.constructor.alloc(3); } }
Writer.alloc = (n) => "w" + n;
function t(n, f) { try { console.log(n, f()); } catch (e) { console.log(n, "THROW", e.constructor.name, e.message); } }
t("grafted read", () => typeof v(new Redis()).constructor.alloc);
t("grafted call", () => v(new Redis()).constructor.alloc(3));
t("sub call", () => v(new Sub2()).constructor.alloc(3));
t("sub read", () => typeof v(new Sub2()).constructor.other);
t("writer", () => v(new Writer()).finish());
// `new x.constructor()` constructs through the class value: a fresh bare emitter for the class that applied the graft
// (EventEmitter), an instance of the subclass otherwise.
function clone(x) { return new x.constructor(); }
function clone0(x) { return new x.constructor(0); }
t("new", () => { const o = clone(v(new Redis())); let hit = ""; o.on("x", (a) => { hit = "got " + a; }); o.emit("x", 5); return hit + "," + Object.keys(o).join(",") + "," + (o instanceof EventEmitter) + "," + o.constructor.name + "," + o.listenerCount("x"); });
t("new arg", () => { const o = clone0(v(new Redis())); return Object.keys(o).join(",") + "," + o.getMaxListeners(); });
t("new twice", () => { const a = clone(v(new Redis())), b = clone(v(new Redis())); a.on("e", () => 1); return a === b ? "same" : "distinct," + a.listenerCount("e") + b.listenerCount("e"); });
t("sub new", () => { const o = clone(v(new Sub2())); return Object.keys(o).join(","); });
