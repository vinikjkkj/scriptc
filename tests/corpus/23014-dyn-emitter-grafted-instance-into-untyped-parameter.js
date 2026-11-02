// A grafted applyMixin(R, EventEmitter) instance flowing into an untyped parameter keeps its
// identity and its class: typeof is "object", exactly as in Node.
import { EventEmitter } from "events";

function applyMixin(derivedConstructor, mixinConstructor) {
  Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
    Object.defineProperty(derivedConstructor.prototype, name, Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name));
  });
}

class R {
  constructor() {
    EventEmitter.call(this);
  }
}

applyMixin(R, EventEmitter);
function take(x) {
  return typeof x;
}
console.log(take(new R()));
