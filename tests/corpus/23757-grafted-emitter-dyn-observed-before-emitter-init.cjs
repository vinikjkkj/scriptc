const { EventEmitter } = require("events");
const util = require("util");
function applyMixin(derivedConstructor, mixinConstructor) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name));
  });
}
// A grafted instance observed through an untyped parameter INSIDE its own constructor, before EventEmitter.call(this)
// ran: it has no _events/_eventsCount/_maxListeners of its own yet, so they read as the prototype's (0 for the count),
// `in` finds them, for-in reaches them through the prototype after the own keys, and no own-key surface lists them.
function probe(x) {
  const ks = [];
  for (const k in x) ks.push(k);
  console.log(typeof x._events, String(x._eventsCount), String(x._maxListeners), Object.keys(x).join(","), JSON.stringify(x));
  console.log(ks.slice(0, 5).join(","), "_events" in x, Object.hasOwn(x, "_events"), util.inspect(x));
}
class Redis {
  constructor() {
    this.a = 1;
    probe(this);
    EventEmitter.call(this);
    probe(this);
  }
}
applyMixin(Redis, EventEmitter);
new Redis();
