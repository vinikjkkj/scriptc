// The ioredis connect() handshake: a handler removes a `var` listener declared
// below it. The removal must match the registered function by identity.
import { EventEmitter } from "events";

class R extends EventEmitter {}

function run(tag) {
  const self = new R();
  const readyHandler = function () {
    self.removeListener("close", closeHandler);
    console.log(tag, "ready");
  };
  var closeHandler = function () {
    console.log(tag, "closed");
  };
  self.once("ready", readyHandler);
  self.once("close", closeHandler);
  return self;
}

const a = run("A");
a.emit("ready");
a.emit("close");
console.log("A listeners", a.listenerCount("close"), a.listenerCount("ready"));
const b = run("B");
b.emit("close");
console.log("B listeners", b.listenerCount("close"), b.listenerCount("ready"));
