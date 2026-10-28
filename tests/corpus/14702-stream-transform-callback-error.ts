// The callback form cb(err): the first argument is the error, and its message reaches 'error'.
import { Transform } from "stream";

class Bad extends Transform {
  _transform(chunk: any, enc: string, cb: (err?: Error | null) => void): void {
    cb(new Error("cbboom"));
  }
}

const b = new Bad();
b.on("error", (e: Error) => console.log("error", e.message));
b.on("close", () => console.log("close"));
b.write("x");
