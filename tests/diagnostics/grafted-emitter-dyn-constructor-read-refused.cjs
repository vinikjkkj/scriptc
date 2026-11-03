const { EventEmitter } = require("events");
function applyMixin(derived, mixin) {
  Object.getOwnPropertyNames(mixin.prototype).forEach((name) => {
    Object.defineProperty(derived.prototype, name, Object.getOwnPropertyDescriptor(mixin.prototype, name));
  });
}
// A boxed grafted instance's `constructor` is EventEmitter (the graft copied it over the class's own): no class value
// stands for that in an unknown slot, so the program that reads it keeps the refusal at the boxing site.
class Redis {
  constructor() { this.a = 1; EventEmitter.call(this); }
}
applyMixin(Redis, EventEmitter);
function ctorOf(x) {
  return x.constructor === EventEmitter;
}
console.log(ctorOf(new Redis()));
