// for await over an objectMode Readable: each pushed value comes out of the
// loop as the value that went in (object, number, array), in order.
import { Readable } from "node:stream";

async function main(): Promise<void> {
  const s = new Readable({ objectMode: true, read() {} });
  s.push({ k: "a" });
  s.push(42);
  s.push(["x", 1]);
  s.push(null);
  for await (const v of s) console.log("chunk", JSON.stringify(v));
  console.log("done");
}
main();
