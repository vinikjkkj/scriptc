const { EventEmitter } = require("events");
function applyMixin(derived, mixin) {
  Object.getOwnPropertyNames(mixin.prototype).forEach((name) => {
    Object.defineProperty(derived.prototype, name, Object.getOwnPropertyDescriptor(mixin.prototype, name));
  });
}
// structuredClone of a boxed grafted instance would have to duplicate its emitter (and Node rejects its listener
// functions): it stays refused at the boxing site.
class Redis {
  constructor() { this.a = 1; EventEmitter.call(this); }
}
applyMixin(Redis, EventEmitter);
function copy(x) {
  return structuredClone(x);
}
console.log(Object.keys(copy(new Redis())).length);
