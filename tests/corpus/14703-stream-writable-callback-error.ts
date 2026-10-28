// A Writable subclass completes _write with cb(err): the message reaches 'error' and then 'close'.
import { Writable } from "stream";

class W extends Writable {
  _write(chunk: any, enc: string, cb: (err?: Error | null) => void): void {
    cb(new Error("wboom " + String(chunk)));
  }
}

const w = new W();
w.on("error", (e: Error) => console.log("error", e.message));
w.on("close", () => console.log("close"));
w.write("x");
