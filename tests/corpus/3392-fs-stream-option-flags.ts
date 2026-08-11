// The `flags` option, and the hazard that makes it worth a program of its
// own: `{ flags: "a" }` silently ignored TRUNCATES a log file the caller
// meant to append to. Every spelling Node accepts is driven through
// createWriteStream over a file with known content, and the resulting
// BYTES are printed — so an ignored flag, a wrong flag, or an O_TRUNC that
// leaked into an append are all visible as different output.
//
// The same spellings also go through openSync, whose flag ladder lives in
// the always-linked scr_lib.c while the stream's lives in the link-gated
// scr_stream.c. Two ladders that must agree forever: this is the test that
// makes them drift LOUDLY.
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";

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
const scratch = "tmp-3392-" + tail(process.argv[1]);
freshDir(scratch);
const out = scratch + "/out.txt";

function show(): string {
  return JSON.stringify(readFileSync(out).toString("latin1"));
}
// fs error messages quote the ABSOLUTE path; the byte comparison must not
// depend on where the checkout lives.
function nopath(m: string): string {
  return m.split(",")[0] ?? "?";
}
async function run(tag: string, go: () => Promise<void>): Promise<void> {
  writeFileSync(out, "BASE");
  let err = "";
  try {
    await go();
  } catch (e) {
    err = e instanceof Error ? nopath(e.message) : "?";
  }
  console.log(tag, show(), err === "" ? "" : "threw " + err);
}
function endWith(w: import("node:stream").Writable, data: string, sink: string[]): Promise<void> {
  return new Promise<void>((res) => {
    w.on("error", (e: Error) => { sink.push(e.message); });
    w.on("close", () => res());
    w.end(data);
  });
}

// THE APPEND HAZARD, first and by itself.
{
  writeFileSync(out, "BASE");
  const errs: string[] = [];
  await endWith(createWriteStream(out, { flags: "a" }), "XY", errs);
  console.log("append keeps what was there:", show(), errs.join("|"));
  await endWith(createWriteStream(out, { flags: "a" }), "Z", errs);
  console.log("append twice:", show(), errs.join("|"));
  writeFileSync(out, "BASE");
  await endWith(createWriteStream(out), "XY", errs);
  console.log("the DEFAULT truncates:", show(), errs.join("|"));
}

// every spelling, over an existing 4-byte file
for (const f of ["r+", "rs+", "sr+", "w", "w+", "a", "a+", "as", "as+", "wx", "xw", "ax", "xa", "sa", "zz"]) {
  const errs: string[] = [];
  writeFileSync(out, "BASE");
  await endWith(createWriteStream(out, { flags: f }), "Z", errs);
  console.log("ws flag", f, show(), errs.length > 0 ? nopath(errs[0] ?? "") : "");
}

// the same spellings through openSync — the SIBLING ladder
for (const f of ["r+", "rs+", "w", "w+", "a", "a+", "as", "wx", "zz"]) {
  writeFileSync(out, "BASE");
  let note = "ok";
  try {
    const fd = openSync(out, f);
    closeSync(fd);
  } catch (e) {
    note = e instanceof Error ? nopath(e.message) : "?";
  }
  console.log("openSync flag", f, note);
}

// `start` interacts with the flag, and O_APPEND must WIN over it
await run("start2 default(w)", async () => {
  const errs: string[] = [];
  await endWith(createWriteStream(out, { start: 2 }), "XY", errs);
});
await run("r+ start1", async () => {
  const errs: string[] = [];
  await endWith(createWriteStream(out, { flags: "r+", start: 1 }), "XY", errs);
});
await run("r+ start5 past eof", async () => {
  const errs: string[] = [];
  await endWith(createWriteStream(out, { flags: "r+", start: 5 }), "Z", errs);
});
await run("a start1 (append wins)", async () => {
  const errs: string[] = [];
  await endWith(createWriteStream(out, { flags: "a", start: 1 }), "Z", errs);
});
await run("w+ start3", async () => {
  const errs: string[] = [];
  await endWith(createWriteStream(out, { flags: "w+", start: 3 }), "Q", errs);
});

// a bad flag is an ERROR EVENT, not a throw at the call, and it must not
// have touched the file
writeFileSync(out, "BASE");
let threwAtTheCall = false;
let evented = "";
try {
  const bad = createWriteStream(out, { flags: "nope" });
  await new Promise<void>((res) => {
    bad.on("error", (e: Error) => { evented = e.message; });
    bad.on("close", () => res());
    bad.end("Q");
  });
} catch {
  threwAtTheCall = true;
}
console.log("bad flag threw at the call?", threwAtTheCall, "| event:", nopath(evented), "| file:", show());

// the read side takes flags too, and a write-only one fails at open
const src = scratch + "/src.bin";
writeFileSync(src, "HELLO");
for (const f of ["r", "r+", "w"]) {
  let got = "";
  let e0 = "";
  const rs = createReadStream(src, { flags: f });
  await new Promise<void>((res) => {
    rs.on("data", (c: Buffer) => { got = got + c.toString("latin1"); });
    rs.on("error", (e: Error) => { e0 = e.message.split(":")[0] ?? "?"; });
    rs.on("close", () => res());
  });
  console.log("rs flag", f, JSON.stringify(got), e0);
}
// ... and a read stream with 'w' must not have truncated it either, since
// Node opens it write-only and fails the READ
console.log("src after the w read:", JSON.stringify(readFileSync(src).toString("latin1")));

for (const name of readdirSync(scratch)) rmSync(scratch + "/" + name);
rmdirSync(scratch);
