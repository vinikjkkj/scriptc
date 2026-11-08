// A directory listing asked for in the Buffer encoding hands back real Buffers: Buffer.isBuffer answers true for each name, and the names decode to
// what the string listing gives.
import fs from "node:fs";
const names = fs.readdirSync(".");
const bufs = fs.readdirSync(".", { encoding: "buffer" });
console.log(bufs.length === names.length, bufs.length > 0, Buffer.isBuffer(bufs[0]), bufs.every((b) => Buffer.isBuffer(b)));
console.log(bufs.map((b) => b.toString("utf8")).join("|") === names.join("|"));
