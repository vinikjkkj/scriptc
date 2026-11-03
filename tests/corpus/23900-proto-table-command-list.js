"use strict";
// Commander-shaped: a forEach over a constant name list writes one prototype member per name, each a closure
// from a factory that captures the name; instances and subclasses reach them through the prototype chain.
class Commander {
  constructor() {
    this.options = { prefix: "k:" };
    this.sent = [];
  }
  sendCommand(name, args, encoding) {
    this.sent.push(name);
    return `${name}(${args.join(",")})${encoding === null ? "B" : "S"}${this.options.prefix}`;
  }
  getBuiltinCommands() {
    return commands.slice(0);
  }
}
const list = ["get", "set", "monitor", "del", "quit", "hget"];
const commands = list.filter((c) => c !== "monitor");
commands.push("sentinel");
function generateFunction(functionName, commandName, encoding) {
  return function (...args) {
    return this.sendCommand(commandName, args, encoding);
  };
}
commands.forEach(function (commandName) {
  Commander.prototype[commandName] = generateFunction(commandName, commandName, "utf8");
  Commander.prototype[commandName + "Buffer"] = generateFunction(commandName + "Buffer", commandName, null);
});
class Redis extends Commander {
  ping() {
    return this.get("ping-key");
  }
}
class Cluster extends Commander {}
const r = new Redis();
const c = new Cluster();
console.log(r.get("a"), r.setBuffer("b", 1), r.sentinel("x", "y"), r.hget("h", "f"));
console.log(c.del(1, 2, 3), c.quitBuffer(), r.ping());
console.log(r.sent, c.sent);
console.log(r.getBuiltinCommands().length);
console.log(r.get === c.get, r.get === r.set, r.getBuffer === r.get);
console.log(typeof r.get, typeof r.nope, r.nope === undefined);
console.log(Commander.prototype.get === r.get, Commander.prototype.sentinelBuffer === c.sentinelBuffer);
console.log(Commander.prototype.monitor, Commander.prototype["monitor"]);
const k = "quit";
const kb = "quitBuffer";
console.log(Commander.prototype[k] === r.quit, Commander.prototype[kb] === r.quitBuffer, r[k] === r.quit, c[kb] === Commander.prototype.quitBuffer);
