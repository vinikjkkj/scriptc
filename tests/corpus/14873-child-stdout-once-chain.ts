// A once() data listener and an on() end listener chained: the once
// listener fires for the first chunk only, and the stream keeps flowing
// after it (Node's readableFlowing is sticky), so the rest is discarded and
// 'end' fires once at EOF. Node's order for one short chunk: first, end.
import { spawn } from "node:child_process";

const child = spawn("node", ["-e", "process.stdout.write('one')"], { stdio: ["ignore", "pipe", "ignore"] });
(child.stdout as NodeJS.ReadableStream)
  .once("data", (chunk: Buffer) => {
    console.log("first", chunk.toString());
  })
  .on("end", () => {
    console.log("end");
  });
