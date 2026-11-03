const { EventEmitter } = require("events");
function applyMixin(derived, mixin) {
  Object.getOwnPropertyNames(mixin.prototype).forEach((name) => {
    Object.defineProperty(derived.prototype, name, Object.getOwnPropertyDescriptor(mixin.prototype, name));
  });
}
// A grafted class that also carries a run-time property table (Object.defineProperty with a run-time name on this):
// the key-listing surfaces are exact, but Object.values over the boxed instance is not, so it stays refused.
class Redis {
  constructor(names) {
    this.a = 1;
    EventEmitter.call(this);
    for (const k of names) Object.defineProperty(this, k, { value: 1, enumerable: true, writable: true, configurable: true });
  }
}
applyMixin(Redis, EventEmitter);
function vals(x) {
  return Object.values(x);
}
console.log(vals(new Redis(["x1", "x2"])).length);
