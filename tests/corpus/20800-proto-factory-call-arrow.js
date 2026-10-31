// A prototype method installed from a factory call that returns an arrow.
// Node calls it; the class has no method of that name, only the prototype datum.
"use strict";
class Commander {
  constructor() { this.options = {}; }
}
function generateFunction(name) {
  return (arg) => name + ":" + arg;
}
Commander.prototype.call = generateFunction("call");
Commander.prototype.callBuffer = generateFunction("callBuffer");
const redis = new Commander();
console.log(typeof redis.call, redis.call(1), redis.callBuffer(2));
