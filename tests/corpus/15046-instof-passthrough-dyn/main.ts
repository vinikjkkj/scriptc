// `instanceof PassThrough` (a Transform subclass in Node) over dyn operands. Columns: PassThrough,
// Transform, Duplex, Readable, Stream, EventEmitter. Node: a PassThrough is a Transform, a Duplex,
// a Readable and a Stream; a Transform is not a PassThrough; a user subclass of PassThrough is one.
import { PassThrough, Transform, Duplex, Readable, Stream } from "stream";
import { EventEmitter as EE } from "events";

class MyPass extends PassThrough {}

function pick(i: number): unknown {
  switch (i) {
    case 0: return new PassThrough();
    case 1: return new Transform();
    case 2: return new Duplex();
    case 3: return new Readable();
    case 4: return new MyPass();
    case 5: return new EE();
    case 6: return { pass: true };
    default: return "text";
  }
}
for (let i = 0; i < 8; i++) {
  const v = pick(i);
  console.log(
    i,
    v instanceof PassThrough,
    v instanceof Transform,
    v instanceof Duplex,
    v instanceof Readable,
    v instanceof Stream,
    v instanceof EE,
  );
}
