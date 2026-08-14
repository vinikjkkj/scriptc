// THE reason a FileHandle is an owned handle and not the raw fd.
//
// close(2) returns the descriptor NUMBER to the OS free list, so the very
// next open(2) hands the same number to a different file. A model that
// carried the fd as a number would let a stale, already-closed handle
// read whatever file inherited the number — the right byte count, no
// error, no diagnostic, the wrong file's bytes. This program pins both
// halves: that the recycling really happens (openSync/closeSync show the
// same number coming back), and that the handle refuses anyway with
// Node's own `EBADF` / "file closed" instead of reading.
//
// It also pins that close() is IDEMPOTENT: Node's second close()
// resolves, it does not reject.
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
function codeOf(e: unknown): string {
  if (e instanceof Error) {
    const c = (e as NodeJS.ErrnoException).code;
    return c === undefined ? "<none>" : c;
  }
  return "<not-an-error>";
}
function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const scratch = "tmp-3422-" + tail(process.argv[1]);
freshDir(scratch);
const A = scratch + "/a.bin";
const B = scratch + "/b.bin";
writeFileSync(A, "AAAAAAAA");
writeFileSync(B, "BBBBBBBB");

// The descriptor number really is recycled — the premise, measured.
const fd1 = openSync(A, "r");
closeSync(fd1);
const fd2 = openSync(B, "r");
console.log("fd recycled:", fd1 === fd2);
closeSync(fd2);

// The handle, through the same sequence.
const fhA = await open(A, "r");
await fhA.close();
const fhB = await open(B, "r");
try {
  const r = await fhA.read(new Uint8Array(8), 0, 8, 0);
  console.log("stale handle READ", r.bytesRead, "bytes — WRONG");
} catch (e) {
  console.log("stale handle:", codeOf(e), "|", msgOf(e));
}
// the live handle still works, so the refusal is about the closed one
const live = await fhB.read(new Uint8Array(8), 0, 8, 0);
console.log("live handle:", live.bytesRead, String.fromCharCode(live.buffer[0]!));
await fhB.close();

// close() is idempotent
const fh = await open(A, "r");
await fh.close();
await fh.close();
await fh.close();
console.log("triple close: resolved");

// every read form refuses after close, and refuses by REJECTING
try {
  await fh.read(new Uint8Array(4), 0, 4, 0);
  console.log("positioned after close: resolved — WRONG");
} catch (e) {
  console.log("positioned after close:", codeOf(e), "|", msgOf(e));
}
try {
  await fh.read(new Uint8Array(4), 0, 4, null);
  console.log("null-pos after close: resolved — WRONG");
} catch (e) {
  console.log("null-pos after close:", codeOf(e), "|", msgOf(e));
}
console.log("fd after close:", fh.fd);

for (const name of readdirSync(scratch)) rmSync(scratch + "/" + name);
rmdirSync(scratch);
