// The fd never leaks. openSync answers the LOWEST free descriptor, so a
// probe that stays flat across hundreds of cycles proves every stream
// returned its own: the drained path, an early destroy(), a destroy in the
// middle of a read, the failed-open path (no fd to return), and the write
// path's end().
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";

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
const scratch = "tmp-3384-" + tail(process.argv[1]);
freshDir(scratch);
const src = scratch + "/src.bin";
writeFileSync(src, "0123456789".repeat(20000));
const out = scratch + "/out.bin";
const missing = scratch + "/nope.bin";

function probe(): number {
  const fd = openSync(src, "r");
  closeSync(fd);
  return fd;
}
const base = probe();

async function drained(): Promise<void> {
  const rs = createReadStream(src);
  rs.on("data", () => {});
  await new Promise<void>((res) => { rs.on("close", () => res()); });
}
async function destroyEarly(): Promise<void> {
  const rs = createReadStream(src);
  rs.destroy();
  await new Promise<void>((res) => { rs.on("close", () => res()); });
}
async function destroyMidRead(): Promise<void> {
  const rs = createReadStream(src);
  rs.on("data", () => { rs.destroy(); });
  await new Promise<void>((res) => { rs.on("close", () => res()); });
}
async function failedOpen(): Promise<void> {
  const rs = createReadStream(missing);
  rs.on("error", () => {});
  await new Promise<void>((res) => { rs.on("close", () => res()); });
}
async function wrote(): Promise<void> {
  const ws = createWriteStream(out);
  ws.write(Buffer.from("x"));
  await new Promise<void>((res) => { ws.on("close", () => res()); ws.end(); });
}
// The sink OPENS and is then destroyed by the failing source: its fd has
// to come back through the pipeline's destroyer, not just through end().
async function failedPipeline(): Promise<void> {
  try {
    await pipeline(createReadStream(missing), createWriteStream(out));
  } catch {
    /* ENOENT from the source */
  }
}

const marks: number[] = [];
for (let i = 0; i < 120; i = i + 1) await drained();
marks.push(probe() - base);
for (let i = 0; i < 120; i = i + 1) await destroyEarly();
marks.push(probe() - base);
for (let i = 0; i < 120; i = i + 1) await destroyMidRead();
marks.push(probe() - base);
for (let i = 0; i < 120; i = i + 1) await failedOpen();
marks.push(probe() - base);
for (let i = 0; i < 120; i = i + 1) await wrote();
marks.push(probe() - base);
for (let i = 0; i < 120; i = i + 1) await failedPipeline();
marks.push(probe() - base);
console.log("fd drift", marks.join(","));

for (const name of readdirSync(scratch)) rmSync(scratch + "/" + name);
rmdirSync(scratch);
