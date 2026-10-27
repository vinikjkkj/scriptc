// Options spread into the Readable constructor: objectMode arrives through
// the spread, and the chunks are whole objects.
import { Readable } from "node:stream";

const opts = { objectMode: true, highWaterMark: 4 };
const s = new Readable({ ...opts, read() {} });
s.on("data", (v) => console.log("data", JSON.stringify(v)));
s.push({ a: 1 });
s.push(null);
