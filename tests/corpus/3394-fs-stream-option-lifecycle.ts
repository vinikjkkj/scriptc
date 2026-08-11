// autoClose and emitClose, and the fd underneath them.
//
// autoClose is Node's autoDestroy and NOTHING else: false means the stream
// does not destroy itself after 'end'/'finish', so there is no 'close' and
// the descriptor is still open — but an EXPLICIT destroy() still returns
// it. Believing autoClose:false means "never close" leaks an fd per
// stream; believing it means "close anyway" closes one out from under a
// caller who meant to keep reading. Both are invisible to a trap census,
// so the descriptor is measured, not asserted: openSync hands back the
// LOWEST free descriptor, so a probe that stays flat across cycles proves
// every stream returned its own, and one that climbs proves a leak.
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";

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
const scratch = "tmp-3394-" + tail(process.argv[1]);
freshDir(scratch);
const src = scratch + "/src.bin";
writeFileSync(src, "0123456789".repeat(3000));
const out = scratch + "/out.bin";

function probe(): number {
  const fd = openSync(src, "r");
  closeSync(fd);
  return fd;
}
const base = probe();

// ── event shapes ────────────────────────────────────────────────────
async function events(tag: string, mk: () => import("node:stream").Readable): Promise<void> {
  const seen: string[] = [];
  const rs = mk();
  rs.on("data", () => {});
  rs.on("end", () => { seen.push("end"); });
  rs.on("close", () => { seen.push("close"); });
  await new Promise<void>((res) => { rs.on("end", () => { setTimeout(() => res(), 25); }); });
  console.log(tag, "events=" + seen.join(" "), "destroyed=" + rs.destroyed);
  rs.destroy();
  await new Promise<void>((res) => { setTimeout(() => res(), 15); });
  console.log(tag, "after an explicit destroy(): destroyed=" + rs.destroyed);
}
await events("autoClose default", () => createReadStream(src, { start: 0, end: 9 }));
await events("autoClose:false", () => createReadStream(src, { autoClose: false, start: 0, end: 9 }));
await events("emitClose:false", () => createReadStream(src, { emitClose: false, start: 0, end: 9 }));

// the write side answers the same way
{
  const seen: string[] = [];
  const ws = createWriteStream(out, { autoClose: false });
  ws.on("finish", () => { seen.push("finish"); });
  ws.on("close", () => { seen.push("close"); });
  await new Promise<void>((res) => { ws.end("hi", () => { setTimeout(() => res(), 25); }); });
  console.log("ws autoClose:false events=" + seen.join(" "), "destroyed=" + ws.destroyed);
  ws.destroy();
  await new Promise<void>((res) => { setTimeout(() => res(), 15); });
  console.log("ws after destroy(): destroyed=" + ws.destroyed);
}

// ── the descriptor, over many cycles ────────────────────────────────
const CYCLES = 60;
async function boundedDrain(): Promise<void> {
  const rs = createReadStream(src, { start: 10, end: 200, highWaterMark: 32 });
  rs.on("data", () => {});
  await new Promise<void>((res) => { rs.on("close", () => res()); });
}
async function autoCloseFalseThenDestroy(): Promise<void> {
  const rs = createReadStream(src, { autoClose: false, start: 0, end: 40 });
  rs.on("data", () => {});
  await new Promise<void>((res) => { rs.on("end", () => res()); });
  rs.destroy();
  await new Promise<void>((res) => { rs.on("close", () => res()); });
}
async function emitCloseFalseDrain(): Promise<void> {
  const rs = createReadStream(src, { emitClose: false, start: 0, end: 40 });
  rs.on("data", () => {});
  await new Promise<void>((res) => { rs.on("end", () => res()); });
}
async function appendCycle(): Promise<void> {
  const ws = createWriteStream(out, { flags: "a" });
  await new Promise<void>((res) => { ws.on("close", () => res()); ws.end("x"); });
}
async function badFlagCycle(): Promise<void> {
  const ws = createWriteStream(out, { flags: "qq" });
  await new Promise<void>((res) => { ws.on("error", () => {}); ws.on("close", () => res()); ws.end("x"); });
}
async function hwmZeroCycle(): Promise<void> {
  const rs = createReadStream(src, { highWaterMark: 0 });
  rs.on("data", () => {});
  await new Promise<void>((res) => { rs.on("close", () => res()); });
}

for (const [name, cycle] of [
  ["boundedDrain", boundedDrain],
  ["autoCloseFalse+destroy", autoCloseFalseThenDestroy],
  ["emitCloseFalse", emitCloseFalseDrain],
  ["append", appendCycle],
  ["badFlag", badFlagCycle],
  ["hwmZero", hwmZeroCycle],
] as [string, () => Promise<void>][]) {
  writeFileSync(out, "");
  for (let i = 0; i < CYCLES; i = i + 1) await cycle();
  console.log("fd drift", name, probe() - base);
}

for (const name of readdirSync(scratch)) rmSync(scratch + "/" + name);
rmdirSync(scratch);
