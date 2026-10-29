// Transform with a byte writable and an objectMode readable: the wire
// framer shape (a 4-byte little-endian length prefix, split across chunks,
// several messages per chunk). Each pushed message reaches 'data' as one
// whole Buffer; 'end', 'finish' and 'close' follow Node's order.
import { Transform } from "stream";

type TransformCallback = (error?: Error | null, data?: string | Buffer) => void;

class Framer extends Transform {
  pending: Buffer;
  seen: number;

  constructor() {
    super({ writableObjectMode: false, readableObjectMode: true });
    this.pending = Buffer.alloc(0);
    this.seen = 0;
  }

  override _transform(chunk: Uint8Array, encoding: string, callback: TransformCallback): void {
    this.seen += 1;
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= 4) {
      const size = this.pending.readUInt32LE(0);
      if (size < 4) {
        return callback(new Error(`Message size cannot be negative: ${size}`));
      }
      if (size > this.pending.length) {
        break;
      }
      const message = this.pending.subarray(0, size);
      this.pending = this.pending.subarray(size);
      this.push(message);
    }
    callback();
  }
}

function frame(n: number, fill: number): Buffer {
  const b = Buffer.alloc(n, fill);
  b.writeUInt32LE(n, 0);
  return b;
}

const all = Buffer.concat([frame(8, 0x11), frame(12, 0x22), frame(20, 0x33)]);
const framer = new Framer();
framer.on("data", (m: Buffer) => {
  console.log("data", m.length, m.readUInt32LE(0), m[4]);
});
framer.on("end", () => console.log("end", framer.seen));
framer.on("finish", () => console.log("finish"));
framer.on("close", () => console.log("close"));
console.log("modes", framer.readableObjectMode, framer.writableObjectMode);
console.log("hwm", framer.readableHighWaterMark, framer.writableHighWaterMark);
framer.write(all.subarray(0, 5));
framer.write(all.subarray(5, 20));
framer.write(all.subarray(20));
framer.end();
console.log("ended");
