// push(object) on a BYTE stream: not an exception. Node emits
// ERR_INVALID_ARG_TYPE on the stream (asynchronously) and push answers false.
// push(undefined) is "no chunk": no error, and push answers true.
import { Readable } from "node:stream";

const b = new Readable({ read() {} });
b.on("error", (e) => console.log("err", e.code, JSON.stringify(e.message)));
b.on("data", () => {});
console.log("obj", b.push({ a: 1 }));
console.log("undef", b.push(undefined));
