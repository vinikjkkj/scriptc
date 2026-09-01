// Re-emitting an UNTYPED emitter's callback parameters as an object literal.
//
// A plain `extends EventEmitter` transport makes `(node, frame)` implicitly
// any, so the payload `{ node, frame }` is a record whose FIELDS are any —
// and `any` maps nowhere without --dynamic. mergeEmit therefore skipped the
// whole emit, the event's tuple stayed EMPTY, and the site died on
// `emit('x') with 1 arguments where the event's tuple has 0`: an arity
// disagreement with a tuple no one ever wrote. zapo's WaClient re-emits its
// node transport's frames exactly this way (`debug_transport_node_in` /
// `_out`), which was two of the six runtime fences left in wam's entry.
//
// An event reaches that state only when no listener site constrained it, and
// any registration the compiler LOWERS becomes one: an unannotated callback
// sets dynListener — the bucket then holds dyn adapters, which is what this
// program registers below — and an annotated one merges its tuple. So a DYN
// tuple position is the answer, and the object literal at it builds through
// the dyn literal builder rather than meeting the record fence one step
// later.
import { EventEmitter } from "node:events";

class Transport extends EventEmitter {
  fire(tag: string, n: number): void {
    this.emit("node_in", { tag: tag }, n);
  }
}

class Client extends EventEmitter {
  private readonly t: Transport;
  constructor(t: Transport) {
    super();
    this.t = t;
    this.t.on("node_in", (node, frame) => {
      this.emit("debug_node_in", { node, frame });
    });
    this.t.on("node_in", (node, frame) => {
      this.emit("debug_node_out", { node, frame });
    });
  }
  fire(tag: string, n: number): void {
    this.t.fire(tag, n);
  }
}

const c = new Client(new Transport());
let seen = 0;
c.on("debug_node_in", (event) => {
  seen += 1;
  console.log("in  " + String(seen) + " node=" + JSON.stringify(event.node) + " frame=" + String(event.frame));
});
c.on("debug_node_out", (event) => {
  seen += 1;
  console.log("out " + String(seen) + " node=" + JSON.stringify(event.node) + " frame=" + String(event.frame));
});
c.fire("message", 7);
c.fire("receipt", 9);
console.log("seen=" + String(seen));
