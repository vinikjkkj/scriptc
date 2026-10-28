// A listener registration returns the stream itself (Node's `this`): the
// result compares identical to the receiver, and it can be stored and used
// as a receiver later.
import { spawn } from "node:child_process";

function wire(stream: NodeJS.ReadableStream): boolean {
  const same = stream.on("data", (chunk: Buffer) => {
    console.log("data", chunk.length);
  });
  return same === stream;
}

const child = spawn("node", ["-e", "process.stdout.write('xyz')"], { stdio: ["ignore", "pipe", "ignore"] });
const out = child.stdout as NodeJS.ReadableStream;
console.log("same", wire(out));
out.on("end", () => {
  console.log("end");
});
