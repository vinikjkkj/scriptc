// The fs stream's placement in the loop. Node runs open/read on the
// threadpool and the completions land in the poll phase, so nothing a
// stream does happens on the calling turn and the first byte costs two
// round trips: a same-body setImmediate beats the first 'data'.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";

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
const scratch = "tmp-3385-" + tail(process.argv[1]);
freshDir(scratch);
const src = scratch + "/src.txt";
writeFileSync(src, "hello");

const log: string[] = [];
const rs = createReadStream(src);
log.push("construct");
rs.on("data", () => log.push("data"));
rs.on("end", () => log.push("end"));
rs.on("close", () => log.push("close"));
process.nextTick(() => log.push("tick"));
void Promise.resolve().then(() => { log.push("micro"); });
setImmediate(() => log.push("immediate"));
log.push("sync");
await new Promise<void>((res) => { rs.on("close", () => res()); });
console.log(log.join(" "));

// destroy() before any read: 'close' alone, and asynchronously.
const d: string[] = [];
const r2 = createReadStream(src);
r2.on("data", () => d.push("data"));
r2.on("end", () => d.push("end"));
r2.on("close", () => d.push("close"));
r2.destroy();
d.push("sync-after-destroy");
await new Promise<void>((res) => { r2.on("close", () => res()); });
console.log(d.join(" "));

// pause() before the first read, resume() later: no chunk escapes early.
const p: string[] = [];
const r3 = createReadStream(src);
r3.on("data", (c: Buffer) => p.push("data" + String(c.length)));
r3.pause();
p.push("paused=" + String(r3.isPaused()));
setTimeout(() => { p.push("resume"); r3.resume(); }, 10);
await new Promise<void>((res) => { r3.on("close", () => res()); });
console.log(p.join(" "));

// A write stream's file does not exist until its open lands.
const late = scratch + "/late.bin";
const ws = createWriteStream(late);
console.log("exists on the calling turn", existsSync(late));
await new Promise<void>((res) => { ws.on("close", () => res()); ws.end(Buffer.from("z")); });
console.log("exists after close", existsSync(late));

for (const name of readdirSync(scratch)) rmSync(scratch + "/" + name);
rmdirSync(scratch);
