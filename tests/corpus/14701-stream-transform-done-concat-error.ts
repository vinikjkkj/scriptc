// The message is built from the chunk; Node's Transform reports it through done(err).
import { Transform } from "stream";

class Bad extends Transform {
  _transform(chunk: any, enc: string, done: (err?: Error | null) => void): void {
    const m = "boom " + String(chunk);
    console.log("chunk", m);
    done(new Error(m));
  }
}

const b = new Bad();
b.on("error", (e: Error) => console.log("error", e.message));
b.on("close", () => console.log("close"));
b.write("x");
