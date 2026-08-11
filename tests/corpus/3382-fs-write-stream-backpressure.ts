// fs.createWriteStream: write() answers false past the highWaterMark (a
// synchronous sink would answer true forever and backpressure would be
// silently free), every byte of every chunk lands, and the terminal order
// is 'finish' then 'close' with end(cb) after the per-write callbacks.
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync } from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") i = i - 1;
  return path.slice(i + 1);
}
function freshDir(dir: string): void {
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) rmSync(dir + "/" + name);
    rmdirSync(dir);
  }
  mkdirSync(dir);
}
const scratch = "tmp-3382-" + tail(process.argv[1]);
freshDir(scratch);
const path = scratch + "/out.bin";

const ws = createWriteStream(path);
console.log("hwm", ws.writableHighWaterMark);
// The asynchronous open means nothing exists yet on this turn.
console.log("exists before the turn ends", existsSync(path));
const rets: string[] = [];
for (let i = 0; i < 6; i = i + 1) {
  rets.push(String(ws.write(Buffer.alloc(8192, 97 + i))));
}
console.log("write returns", rets.join(","));

const order: string[] = [];
ws.write(Buffer.from("tail-"), () => order.push("cb"));
ws.on("finish", () => order.push("finish"));
ws.on("close", () => order.push("close"));
ws.end(Buffer.from("done"), () => order.push("endcb"));
order.push("sync-after-end");
await new Promise<void>((res) => { ws.on("close", () => res()); });
console.log("order", order.join(","));

const body = readFileSync(path);
console.log("bytes", body.length);
let ok = true;
for (let i = 0; i < 6; i = i + 1) {
  for (let j = 0; j < 8192; j = j + 1) {
    if (body[i * 8192 + j] !== 97 + i) ok = false;
  }
}
console.log("payload exact", ok, body.subarray(6 * 8192).toString("utf8"));

rmSync(path);
rmdirSync(scratch);
