// objectMode highWaterMark counts ENTRIES: push() answers false once the
// buffered object count reaches the mark; read() takes one whole object.
import { Readable } from "node:stream";

const s = new Readable({ objectMode: true, highWaterMark: 2, read() {} });
console.log("push1", s.push({ n: 1 }));
console.log("push2", s.push({ n: 2 }));
console.log("push3", s.push({ n: 3 }));
console.log("length", s.readableLength);
console.log("first", JSON.stringify(s.read()));
console.log("length", s.readableLength);
