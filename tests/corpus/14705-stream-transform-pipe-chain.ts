// Two Transform subclasses piped together: the downstream 'end' sees every converted chunk.
import { Transform } from "stream";

class Up extends Transform {
  _transform(chunk: any, enc: string, cb: (err?: Error | null, data?: any) => void): void {
    cb(null, String(chunk).toUpperCase());
  }
}

class Dbl extends Transform {
  _transform(chunk: any, enc: string, cb: (err?: Error | null, data?: any) => void): void {
    this.push(String(chunk));
    cb(null, String(chunk));
  }
}

const u = new Up();
const d = new Dbl();
let acc = "";
d.on("data", (x: any) => { acc += String(x); });
d.on("end", () => console.log("acc", acc));
u.pipe(d);
u.write("hello ");
u.end("world");
