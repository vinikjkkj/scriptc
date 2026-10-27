// destroy(err) on an objectMode Readable: 'error' with the Error, then 'close'.
import { Readable } from "node:stream";

const s = new Readable({ objectMode: true, read() {} });
s.on("error", (e) => console.log("error", (e as Error).message));
s.on("close", () => console.log("close"));
s.destroy(new Error("boom"));
console.log("destroyed", s.destroyed);
