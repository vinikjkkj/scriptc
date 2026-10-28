// Chained listener registration on a piped child stream: each on()/once()
// answers its receiver (Node's `this`), so a data listener and an end
// listener chain in one statement. The output order is the pinned one:
// data before end, then the child's exit.
import { spawn } from "node:child_process";

const child = spawn("node", ["-e", "process.stdout.write('alpha\\nbeta\\n')"], { stdio: ["ignore", "pipe", "ignore"] });
let bytes = 0;
(child.stdout as NodeJS.ReadableStream)
  .on("data", (chunk: Buffer) => {
    bytes += chunk.length;
  })
  .on("end", () => {
    console.log("end", bytes);
  });
child.on("exit", (code) => {
  console.log("exit", code);
});
