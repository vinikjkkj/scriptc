const { EventEmitter } = require("events");
function applyMixin(derived, mixin) {
  Object.getOwnPropertyNames(mixin.prototype).forEach((name) => {
    Object.defineProperty(derived.prototype, name, Object.getOwnPropertyDescriptor(mixin.prototype, name));
  });
}
// A boxed grafted instance's `constructor` is EventEmitter (the graft copied it over the class's own). Reading its
// `.name` or comparing it is exact; constructing through it is not lowered for EventEmitter's class value, so the program
// that does keeps the refusal at the boxing site.
class Redis {
  constructor() { this.a = 1; EventEmitter.call(this); }
}
applyMixin(Redis, EventEmitter);
function make(x) {
  const C = x.constructor;
  return new C();
}
console.log(typeof make(new Redis()));
