// A Transform subclass with a typed constructor: the event order of data, finish, end and close.
import { Transform } from "stream";

class Enc extends Transform {
  conv: (s: string) => string;
  constructor(conv: (s: string) => string) {
    super({});
    this.conv = conv;
  }
  _transform(chunk: any, enc: string, done: (err?: Error | null) => void): void {
    const res = this.conv(String(chunk));
    if (res.length) this.push(res);
    done();
  }
  _flush(done: (err?: Error | null) => void): void {
    const res = this.conv("!");
    if (res.length) this.push(res);
    done();
  }
}

const s = new Enc((c: string) => c.toUpperCase());
s.on("data", (d: any) => console.log("data", String(d)));
s.on("finish", () => console.log("finish"));
s.on("end", () => console.log("end"));
s.on("close", () => console.log("close"));
s.write("ab");
s.write("cd");
s.end("ef");
console.log("sync done");
