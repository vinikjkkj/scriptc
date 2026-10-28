// A stream-FREE program: no stream class is in its class graph, so the Readable, Writable,
// Duplex, Transform and stream/emitter vtable intervals are the empty default. The user classes
// have no runtime ancestor (except the EventEmitter subclass, which reaches the emitter root).
// Columns: Stream, Readable, Writable, Duplex, Transform, EventEmitter, net.Socket, net.Server.
import { Stream, Readable, Writable, Duplex, Transform } from "stream";
import { EventEmitter } from "events";
import * as net from "net";

class Base { b = 1; }
class Child extends Base { c = 2; }
class Other { o = 3; }
class Emitter extends EventEmitter { e = 4; }

function pick(i: number): unknown {
  if (i === 0) return new Base();
  if (i === 1) return new Child();
  if (i === 2) return new Other();
  if (i === 3) return { plain: true };
  if (i === 4) return 42;
  if (i === 5) return null;
  if (i === 6) return undefined;
  return new Emitter();
}
for (let i = 0; i < 8; i++) {
  const v = pick(i);
  console.log(
    i,
    v instanceof Stream,
    v instanceof Readable,
    v instanceof Writable,
    v instanceof Duplex,
    v instanceof Transform,
    v instanceof EventEmitter,
    v instanceof net.Socket,
    v instanceof net.Server,
  );
}
console.log("done", new Base() instanceof Stream, new Emitter() instanceof EventEmitter);
