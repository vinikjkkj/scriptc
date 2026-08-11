// The option validation, and WHERE it happens — the two are different
// contracts and conflating them is observable. Node validates
// start/end/highWaterMark/mode SYNCHRONOUSLY in the constructor and
// THROWS; it converts `flags` and opens the file asynchronously, so a bad
// flag and a missing file are 'error' EVENTS. A stream that threw its
// range error must also not have created or truncated anything.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";

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
const scratch = "tmp-3393-" + tail(process.argv[1]);
freshDir(scratch);
const src = scratch + "/src.bin";
writeFileSync(src, "0123456789");

function attempt(tag: string, go: () => void): void {
  let msg = "no throw";
  try {
    go();
  } catch (e) {
    msg = e instanceof Error ? e.message : "?";
  }
  console.log(tag, "|", msg);
}

// the synchronous range family, exact texts
attempt("start -1", () => { createReadStream(src, { start: -1 }).destroy(); });
attempt("start 1.5", () => { createReadStream(src, { start: 1.5 }).destroy(); });
attempt("start 2^53", () => { createReadStream(src, { start: 9007199254740992 }).destroy(); });
attempt("end -2", () => { createReadStream(src, { end: -2 }).destroy(); });
attempt("end 0.5", () => { createReadStream(src, { end: 0.5 }).destroy(); });
attempt("start > end", () => { createReadStream(src, { start: 10, end: 9 }).destroy(); });
attempt("start == end", () => { createReadStream(src, { start: 4, end: 4 }).destroy(); });
attempt("hwm -1", () => { createReadStream(src, { highWaterMark: -1 }).destroy(); });
attempt("hwm 1.5", () => { createReadStream(src, { highWaterMark: 1.5 }).destroy(); });
attempt("hwm 0", () => { createReadStream(src, { highWaterMark: 0 }).destroy(); });
attempt("ws start -3", () => { createWriteStream(scratch + "/never1.bin", { start: -3 }).destroy(); });
attempt("ws hwm -8", () => { createWriteStream(scratch + "/never2.bin", { highWaterMark: -8 }).destroy(); });

// WRITTEN-BUT-DEGENERATE values. These are the reason "absent" travels as
// a presence bitmask instead of a sentinel VALUE: NaN and "" are things a
// program can legally write, and Node rejects both BY NAME. Reading either
// as "the key was not written" is a silent wrong answer.
attempt("start NaN", () => { createReadStream(src, { start: NaN }).destroy(); });
attempt("end NaN", () => { createReadStream(src, { end: NaN }).destroy(); });
attempt("hwm NaN", () => { createReadStream(src, { highWaterMark: NaN }).destroy(); });
attempt("start Infinity", () => { createReadStream(src, { start: Infinity }).destroy(); });

// ... and the ones Node reports ASYNCHRONOUSLY, because it checks them
// inside fs.open rather than in the constructor. mode BEATS flags.
async function evented(tag: string, mk: () => import("node:stream").Readable): Promise<void> {
  let ev = "no error";
  const rs = mk();
  await new Promise<void>((res) => {
    rs.on("error", (e: Error) => { ev = e.message; });
    rs.on("close", () => res());
    rs.resume();
  });
  console.log(tag, "|", ev);
}
await evented("flags empty", () => createReadStream(src, { flags: "" }));
await evented("flags space", () => createReadStream(src, { flags: " " }));
await evented("mode NaN", () => createReadStream(src, { mode: NaN }));
await evented("mode -1", () => createReadStream(src, { mode: -1 }));
await evented("mode 1e10", () => createReadStream(src, { mode: 10000000000 }));
await evented("mode 0.5", () => createReadStream(src, { mode: 0.5 }));
await evented("mode beats flags", () => createReadStream(src, { flags: "zz", mode: -1 }));
await evented("mode 438 ok", () => createReadStream(src, { mode: 438 }));

// a constructor that threw did not touch the filesystem: the open is
// asynchronous and the throw happens before it is ever scheduled
console.log("never1 exists?", existsSync(scratch + "/never1.bin"));
console.log("never2 exists?", existsSync(scratch + "/never2.bin"));

// ... and the same is true of a VALID createWriteStream on the calling
// turn: Node opens on the threadpool, so the file is not there yet
const late = scratch + "/late.bin";
const lw = createWriteStream(late);
console.log("createWriteStream then existsSync on the SAME turn:", existsSync(late));
await new Promise<void>((res) => { lw.on("close", () => res()); lw.end("x"); });
console.log("after close:", existsSync(late), JSON.stringify(readFileSync(late).toString("latin1")));

// a missing source is an EVENT, not a throw, options or no options
for (const tag of ["plain", "bounded"]) {
  const missing = scratch + "/nope.bin";
  let threw = false;
  let ev = "";
  try {
    const rs = tag === "plain" ? createReadStream(missing) : createReadStream(missing, { start: 2, end: 5 });
    await new Promise<void>((res) => {
      rs.on("error", (e: Error) => { ev = e.message.split(":")[0] ?? "?"; });
      rs.on("close", () => res());
    });
  } catch {
    threw = true;
  }
  console.log("missing", tag, "threw=" + threw, "event=" + ev);
}

// an out-of-range start over a file that DOES exist leaves it untouched
writeFileSync(scratch + "/keep.txt", "KEEP");
attempt("ws start -1 over an existing file", () => {
  createWriteStream(scratch + "/keep.txt", { start: -1 }).destroy();
});
console.log("keep.txt:", JSON.stringify(readFileSync(scratch + "/keep.txt").toString("latin1")));

for (const name of readdirSync(scratch)) rmSync(scratch + "/" + name);
rmdirSync(scratch);
