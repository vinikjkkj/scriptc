// fs/promises.open resolves a FileHandle, and the three things about its
// read that a wrong implementation gets wrong quietly:
//
//   1. the resolved record's `buffer` is THE SAME object that went in
//      (Node: `res.buffer === buf`), not a copy;
//   2. a NUMERIC position reads from there and leaves the file position
//      alone, while `null` reads from and ADVANCES it — two different
//      syscalls, which is why they are two different lowerings and not
//      one with an "absent position" sentinel;
//   3. a short read at the end of the file is a short read, not EOF, and
//      a read starting at the end answers 0.
import { existsSync, mkdirSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
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
function show(b: Uint8Array, n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(String(b[i]));
  return parts.join(",");
}

const scratch = "tmp-3421-" + tail(process.argv[1]);
freshDir(scratch);
const src = scratch + "/src.bin";
writeFileSync(src, "0123456789");

const fh = await open(src, "r");
console.log("fd positive:", fh.fd > 0);

// 1 — buffer identity survives the record
const buf = new Uint8Array(4);
const r1 = await fh.read(buf, 0, 4, 0);
console.log("read1:", r1.bytesRead, show(r1.buffer, 4), "same object:", r1.buffer === buf);

// 2 — a numeric position does NOT move the file position
const r2 = await fh.read(new Uint8Array(3), 0, 3, 5);
console.log("positioned:", r2.bytesRead, show(r2.buffer, 3));
const r3 = await fh.read(new Uint8Array(3), 0, 3, null);
console.log("null-pos 1:", r3.bytesRead, show(r3.buffer, 3));
const r4 = await fh.read(new Uint8Array(3), 0, 3, null);
console.log("null-pos 2:", r4.bytesRead, show(r4.buffer, 3));

// 3 — a short read is a short read; at the end it is zero
const r5 = await fh.read(new Uint8Array(100), 0, 100, 6);
console.log("short:", r5.bytesRead, show(r5.buffer, r5.bytesRead));
const r6 = await fh.read(new Uint8Array(10), 0, 10, 10);
console.log("at-eof:", r6.bytesRead);

// a non-zero offset fills from there and leaves the head alone
const off = new Uint8Array(6);
const r7 = await fh.read(off, 2, 3, 0);
console.log("offset:", r7.bytesRead, show(r7.buffer, 6));

// a zero-length read touches nothing
const r8 = await fh.read(new Uint8Array(2), 0, 0, 0);
console.log("zero-len:", r8.bytesRead, show(r8.buffer, 2));

await fh.close();
console.log("fd after close:", fh.fd);

// an empty file reads zero bytes
const empty = scratch + "/empty.bin";
writeFileSync(empty, "");
const fh2 = await open(empty, "r");
const r9 = await fh2.read(new Uint8Array(8), 0, 8, 0);
console.log("empty:", r9.bytesRead);
await fh2.close();

// the whole point of the surface: read a file's head
async function readHead(p: string, n: number): Promise<Uint8Array> {
  const h = await open(p, "r");
  try {
    const b = new Uint8Array(n);
    const { bytesRead } = await h.read(b, 0, n, 0);
    return b.subarray(0, bytesRead);
  } finally {
    await h.close();
  }
}
const head = await readHead(src, 4);
console.log("readHead:", head.length, show(head, head.length));
const over = await readHead(src, 40);
console.log("readHead over:", over.length);

for (const name of readdirSync(scratch)) rmSync(scratch + "/" + name);
rmdirSync(scratch);
