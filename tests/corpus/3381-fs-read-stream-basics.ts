// fs.createReadStream over the node:stream machinery: chunk sizes at the
// ReadStream highWaterMark (64 KiB on EVERY platform — the shared byte
// default is 16 KiB on win32), the bytes exact, 'end' before 'close', and
// a short trailing read that is NOT mistaken for EOF.
import { createReadStream, mkdirSync, existsSync, rmSync, rmdirSync, readdirSync, writeFileSync } from "node:fs";

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
const scratch = "tmp-3381-" + tail(process.argv[1]);
freshDir(scratch);

// 140000 bytes: two full highWaterMark reads plus a short tail.
const big = Buffer.alloc(140000);
for (let i = 0; i < big.length; i = i + 1) big[i] = (i * 37 + 11) % 256;
const path = scratch + "/big.bin";
writeFileSync(path, big);

const rs = createReadStream(path);
console.log("hwm", rs.readableHighWaterMark);
const sizes: number[] = [];
let sum = 0;
const order: string[] = [];
rs.on("data", (c: Buffer) => {
  sizes.push(c.length);
  for (let i = 0; i < c.length; i = i + 1) sum = (sum + c[i]!) % 1000003;
});
rs.on("end", () => order.push("end"));
rs.on("close", () => order.push("close"));
await new Promise<void>((res) => { rs.on("close", () => res()); });
console.log("sizes", sizes.join(","));
console.log("sum", sum);
console.log("order", order.join(","));

// An empty file is a single zero-byte read: 'end' with no 'data' at all.
const empty = scratch + "/empty.bin";
writeFileSync(empty, "");
const e = createReadStream(empty);
let datas = 0;
e.on("data", () => { datas = datas + 1; });
await new Promise<void>((res) => { e.on("close", () => res()); });
console.log("empty datas", datas);

rmSync(path);
rmSync(empty);
rmdirSync(scratch);
