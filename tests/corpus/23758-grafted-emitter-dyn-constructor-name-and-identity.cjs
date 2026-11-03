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
