// A JS function `var` read by a closure above its declaration (the ioredis
// Redis.connect shape): the forward read is a checked-dynamic slot, and the
// listener registrations must still match by identity.
import { EventEmitter } from "events";

class R extends EventEmitter {}

function run(tag) {
  const self = new R();
  const readyHandler = function () {
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
console.log("after ready", a.listenerCount("close"));
const b = run("B");
b.emit("close");
console.log("after close", b.listenerCount("ready"));
