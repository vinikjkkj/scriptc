// Two installed methods from one factory, called through instances in one expression.
"use strict";
class Pipeline {
  constructor() { this.queue = []; }
}
function generateFunction(name, kind) {
  return function (cmd) {
    this.queue.push(name + "/" + kind + "/" + cmd);
    return this.queue.length;
  };
}
Pipeline.prototype.call = generateFunction("call", "sync");
Pipeline.prototype.callBuffer = generateFunction("callBuffer", "buf");
const p = new Pipeline();
console.log(p.call("a"), p.callBuffer("b"), p.call("c"));
console.log(p.queue.join(","));
