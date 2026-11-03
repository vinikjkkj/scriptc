const { EventEmitter } = require("events");
function applyMixin(derived, mixin) {
  Object.getOwnPropertyNames(mixin.prototype).forEach((name) => {
    Object.defineProperty(derived.prototype, name, Object.getOwnPropertyDescriptor(mixin.prototype, name));
  });
}
// The grafted class initialises the emitter in a method, not at the top level of its constructor: the emitter's own keys
// then appear where the instance's order record cannot state, so a boxed instance in a program that enumerates or prints
// dynamic values stays refused.
class Redis {
  constructor() {
    this.a = 1;
    this.init();
  }
  init() { EventEmitter.call(this); }
}
applyMixin(Redis, EventEmitter);
function show(x) {
  console.log(Object.keys(x));
}
show(new Redis());
