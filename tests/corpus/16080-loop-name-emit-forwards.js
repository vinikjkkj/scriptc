// Event names that come from a for-of over a literal array (the ioredis
// ClusterSubscriber shape): each `on` registers one static name per candidate,
// and the emit inside the listener dispatches over the same closed set.
import { EventEmitter } from "events";

class R extends EventEmitter {}

const r = new R();
const sub = new R();
for (const event of ["message", "messageBuffer"]) {
  sub.on(event, (a, b) => {
    r.emit(event, a, b);
  });
}
r.on("message", (a, b) => console.log("msg", a, b));
r.on("messageBuffer", (a, b) => console.log("mb", a, b));
sub.emit("message", 1, 2);
sub.emit("messageBuffer", "x", "y");
sub.emit("other", 3);
console.log(sub.listenerCount("message"), sub.listenerCount("messageBuffer"), sub.listenerCount("other"));
