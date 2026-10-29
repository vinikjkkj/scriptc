// Transform with a readable objectMode side: callback(err) reaches 'error'
// as the same object that was passed, and no 'data' follows the failure.
import { Transform } from "stream";

type TransformCallback = (error?: Error | null, data?: string | Buffer) => void;

const boom = new Error("bad frame");

class Checker extends Transform {
  constructor() {
    super({ writableObjectMode: false, readableObjectMode: true });
  }

  override _transform(chunk: Uint8Array, encoding: string, callback: TransformCallback): void {
    if (chunk[0] === 0xff) {
      return callback(boom);
    }
    this.push(chunk);
    callback();
  }
}

const c = new Checker();
c.on("data", (v: Buffer) => console.log("data", v.length, v[0]));
let got: Error | null = null;
c.on("error", (e: Error) => {
  got = e;
  console.log("error", e.message);
});
c.on("close", () => {
  console.log("close", got === boom);
});
c.write(Buffer.from([1, 2, 3]));
c.write(Buffer.from([0xff, 9]));
c.write(Buffer.from([4]));
console.log("writes done");
