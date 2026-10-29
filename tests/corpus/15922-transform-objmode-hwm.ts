// The readable side of a Transform in objectMode counts OBJECTS against its
// highWaterMark (default 16), while its writable side stays in bytes.
// readableHighWaterMark (given to the construction form) overrides it.
import { Transform } from "stream";

type TransformCallback = (error?: Error | null, data?: string | Buffer) => void;

class Pusher extends Transform {
  results: boolean[];

  constructor() {
    super({ writableObjectMode: false, readableObjectMode: true });
    this.results = [];
  }

  override _transform(chunk: Uint8Array, encoding: string, callback: TransformCallback): void {
    this.results.push(this.push(chunk));
    callback();
  }
}

const a = new Pusher();
console.log("default", a.readableHighWaterMark, a.writableHighWaterMark);
for (let i = 0; i < 18; i++) {
  a.write(Buffer.from([i, i + 1]));
}
console.log("length", a.readableLength, a.writableLength);
console.log("pushes", a.results.map((r) => (r ? "1" : "0")).join(""));

const b = new Transform({ readableObjectMode: true, readableHighWaterMark: 3 });
console.log("explicit", b.readableHighWaterMark, b.readableObjectMode, b.writableObjectMode);
