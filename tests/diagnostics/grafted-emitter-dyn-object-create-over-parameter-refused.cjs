const { EventEmitter } = require("events");
function applyMixin(derived, mixin) {
  Object.getOwnPropertyNames(mixin.prototype).forEach((name) => {
    Object.defineProperty(derived.prototype, name, Object.getOwnPropertyDescriptor(mixin.prototype, name));
  });
}
// Object.create over a value the program did not build (a parameter that can hold a grafted instance) cannot be a plain
// prototype link, so the program keeps the refusal at the boxing site.
class Redis {
  constructor() { this.a = 1; EventEmitter.call(this); }
}
applyMixin(Redis, EventEmitter);
function link(proto) {
  return Object.create(proto);
}
console.log(typeof link(new Redis()));
