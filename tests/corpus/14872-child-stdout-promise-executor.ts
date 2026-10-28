// The promise-wrapped stream read: an expression-bodied executor arrow
// whose value is the registration result (the executor discards it). The
// data listener drives the reads; the end listener resolves the promise.
import { spawn } from "node:child_process";

function drain(stream: NodeJS.ReadableStream): Promise<number> {
  let total = 0;
  stream.on("data", (buffer: Buffer) => {
    total += buffer.length;
  });
  return new Promise<number>((resolve) => stream.on("end", () => resolve(total)));
}

async function main(): Promise<void> {
  const child = spawn("node", ["-e", "process.stdout.write('0123456789')"], { stdio: ["ignore", "pipe", "ignore"] });
  console.log("total", await drain(child.stdout as NodeJS.ReadableStream));
}
main().catch((e) => console.log("failed", (e as Error).message));
