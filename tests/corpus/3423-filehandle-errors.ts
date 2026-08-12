// FileHandle failures REJECT — they are not thrown at the call — and the
// rejection carries Node's `code`, not merely a message that happens to
// start with the right letters. A version that rebuilt the Error from
// `.message` alone would print identically on the first column here and
// `<none>` on the second, which is the whole reason the second column
// exists.
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
function codeOf(e: unknown): string {
  if (e instanceof Error) {
    const c = (e as NodeJS.ErrnoException).code;
    return c === undefined ? "<none>" : c;
  }
  return "<not-an-error>";
}
function report(label: string, e: unknown): void {
  const m = e instanceof Error ? e.message : String(e);
  console.log(label, "| code:", codeOf(e), "| name:", e instanceof Error ? e.name : "?", "| msg:", m);
}

const scratch = "tmp-3423-" + tail(process.argv[1]);
freshDir(scratch);
const src = scratch + "/src.bin";
writeFileSync(src, "0123456789");
const missing = scratch + "/nope.bin";

// open of a missing path rejects with ENOENT, quoting the path
try {
  await open(missing, "r");
  console.log("missing open: RESOLVED — WRONG");
} catch (e) {
  const m = e instanceof Error ? e.message : "";
  console.log("missing open | code:", codeOf(e), "| starts:", m.startsWith("ENOENT"), "| names path:", m.includes("nope.bin"));
}

// an unknown flag is Node's TypeError, before any syscall
try {
  await open(src, "zz");
  console.log("bad flag: RESOLVED — WRONG");
} catch (e) {
  report("bad flag     ", e);
}

const fh = await open(src, "r");

// length beyond the buffer's remaining window: ERR_OUT_OF_RANGE
try {
  await fh.read(new Uint8Array(4), 0, 999, 0);
  console.log("long length: RESOLVED — WRONG");
} catch (e) {
  report("long length  ", e);
}

// the same, measured from a non-zero offset
try {
  await fh.read(new Uint8Array(8), 6, 4, 0);
  console.log("offset+length: RESOLVED — WRONG");
} catch (e) {
  report("offset+length", e);
}

// a negative offset
try {
  await fh.read(new Uint8Array(4), -1, 2, 0);
  console.log("neg offset: RESOLVED — WRONG");
} catch (e) {
  report("neg offset   ", e);
}

// an offset past the end of the buffer
try {
  await fh.read(new Uint8Array(4), 9, 1, 0);
  console.log("far offset: RESOLVED — WRONG");
} catch (e) {
  report("far offset   ", e);
}

// the handle still works after a rejected read — the failure is not fatal
const ok = await fh.read(new Uint8Array(4), 0, 4, 0);
console.log("still usable:", ok.bytesRead);
await fh.close();

// the failure is a REJECTION, not a synchronous throw: the call returns a
// promise and the program reaches the next line before it is observed.
const fh2 = await open(src, "r");
await fh2.close();
let reached = false;
const p = fh2.read(new Uint8Array(4), 0, 4, 0);
reached = true;
console.log("call returned:", reached);
try {
  await p;
  console.log("deferred: RESOLVED — WRONG");
} catch (e) {
  console.log("deferred      | code:", codeOf(e));
}

for (const name of readdirSync(scratch)) rmSync(scratch + "/" + name);
rmdirSync(scratch);
