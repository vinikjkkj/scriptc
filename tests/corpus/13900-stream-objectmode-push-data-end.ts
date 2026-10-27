// objectMode Readable: pushed values reach 'data' listeners unchanged (object,
// number, array), in push order, then 'end' follows push(null).
import { Readable } from "node:stream";

const s = new Readable({ objectMode: true, read() {} });
s.on("data", (v) => console.log("data", JSON.stringify(v)));
s.on("end", () => console.log("end"));
s.push({ id: 1 });
s.push(2);
s.push(["a", "b"]);
s.push(null);
console.log("pushed");
