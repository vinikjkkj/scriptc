// A grafted applyMixin(R, EventEmitter) instance flowing into an untyped
// parameter: its dyn view has no emitter members (typeof x.emit is
// 'undefined' there, x.on throws), so the build refuses the flow (OPEN dyn
// emitter model, dynx1). Node prints 'object' for this program.
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
