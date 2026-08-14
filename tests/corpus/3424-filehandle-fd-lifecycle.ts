// The descriptor never leaks. openSync answers the LOWEST free fd, so a
// probe that stays flat across hundreds of cycles proves every handle
// gave its own back. Five paths, each 60 cycles, plus a CONTROL that
// runs the identical loop with no FileHandle in it — without the control
// a flat number proves nothing about the handles and a rising one blames
// the wrong thing.
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";

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

const scratch = "tmp-3424-" + tail(process.argv[1]);
freshDir(scratch);
const src = scratch + "/src.bin";
writeFileSync(src, "0123456789".repeat(64));
const missing = scratch + "/nope.bin";

function probe(): number {
  const fd = openSync(src, "r");
  closeSync(fd);
  return fd;
}
const base = probe();
const CYCLES = 60;

// 1 — open, read, close
async function readAndClose(): Promise<void> {
  const h = await open(src, "r");
  await h.read(new Uint8Array(16), 0, 16, 0);
  await h.close();
}
// 2 — open and close with no read at all
async function closeOnly(): Promise<void> {
  const h = await open(src, "r");
  await h.close();
}
// 3 — many reads on one handle
async function manyReads(): Promise<void> {
  const h = await open(src, "r");
  for (let i = 0; i < 5; i++) await h.read(new Uint8Array(8), 0, 8, i * 8);
  await h.close();
}
// 4 — a rejected read still leaves the handle closable
async function failedRead(): Promise<void> {
  const h = await open(src, "r");
  try {
    await h.read(new Uint8Array(4), 0, 999, 0);
  } catch (e) {
    void e;
  }
  await h.close();
}
// 5 — a failed open has no descriptor to give back
async function failedOpen(): Promise<void> {
  try {
    const h = await open(missing, "r");
    await h.close();
  } catch (e) {
    void e;
  }
}
// control — the same loop shape with no handle in it
async function control(): Promise<void> {
  const b = new Uint8Array(16);
  b[0] = 1;
}

async function run(name: string, f: () => Promise<void>): Promise<void> {
  for (let i = 0; i < CYCLES; i++) await f();
  console.log(name, probe() - base);
}

await run("control      ", control);
await run("readAndClose ", readAndClose);
await run("closeOnly    ", closeOnly);
await run("manyReads    ", manyReads);
await run("failedRead   ", failedRead);
await run("failedOpen   ", failedOpen);
console.log("final drift  ", probe() - base);

for (const name of readdirSync(scratch)) rmSync(scratch + "/" + name);
rmdirSync(scratch);
