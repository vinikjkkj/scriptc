// A Transform subclass completes _transform with done(err): the 'error' listener sees the same message.
import { Transform } from "stream";

class Bad extends Transform {
  _transform(chunk: any, enc: string, done: (err?: Error | null) => void): void {
    done(new Error("boom"));
  }
}

const b = new Bad();
b.on("error", (e: Error) => console.log("error", e.message));
b.on("close", () => console.log("close"));
b.write("x");
