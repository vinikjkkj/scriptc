// A grafted applyMixin(Y, EventEmitter) instance owns the emitter's state keys (_events, _eventsCount,
// _maxListeners and two symbols) at a position its constructor decides, with listener tables as values.
// Boxing one into an unknown slot is refused in a program that also inspects dynamic values, because
// util.inspect / Object.keys / JSON.stringify over the boxed instance could not print what Node prints.
const { EventEmitter } = require("events");
function applyMixin(derived, mixin) {
  Object.getOwnPropertyNames(mixin.prototype).forEach((name) => {
    Object.defineProperty(derived.prototype, name, Object.getOwnPropertyDescriptor(mixin.prototype, name));
  });
}
class Redis {
  constructor() {
    this.a = 1;
    EventEmitter.call(this);
  }
}
applyMixin(Redis, EventEmitter);
function show(x) {
  console.log(x);
}
show(new Redis());
