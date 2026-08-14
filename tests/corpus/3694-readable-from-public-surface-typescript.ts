// The same eager-seed defect seen from TypeScript, where `_readableState`
// cannot be spelled at all.
//
// `_readableState` has no declared type, so a TypeScript source cannot
// read it — two blocks have now recorded that as the reason a related
// conversion was withdrawn, and it is why the `.cjs` twin of this fixture
// (3693) is the one that names the internal fields. The PUBLIC surface
// shows the same thing: a freshly constructed `Readable.from([...])`
// answered `readableLength` 2 where Node answers 0, because the runtime
// pushed the whole array inside the constructor instead of pulling one
// entry per _read.
//
// Everything below is the declared surface a TypeScript program actually
// has, and every line of it must agree with Node.

import { Readable, PassThrough } from "node:stream";

async function main(): Promise<void> {
  const r = Readable.from(["a", "b"]);
  console.log("pre:", r.readableEnded, r.readableLength, r.readable, r.destroyed);
  console.log("hwm:", r.readableHighWaterMark, "objectMode:", r.readableObjectMode);
  console.log("flowing:", r.readableFlowing);

  const got: string[] = [];
  for await (const c of r) got.push(c.toString());
  console.log("got:", got.join("|"));
  console.log("post:", r.readableEnded, r.readableLength, r.destroyed);

  // a single string source: Node's one-whole-chunk special case
  const s = Readable.from("hello");
  console.log("str-pre:", s.readableEnded, s.readableLength);
  const parts: string[] = [];
  for await (const c of s) parts.push(c.toString());
  console.log("str:", parts.join("|"), parts.length, s.readableEnded);

  // a Buffer array source
  const bufs = Readable.from([Buffer.from("p"), Buffer.from("qq")]);
  console.log("buf-pre:", bufs.readableEnded, bufs.readableLength);
  const bseen: string[] = [];
  for await (const c of bufs) bseen.push(c.toString());
  console.log("buf:", bseen.join("|"), bufs.readableEnded);

  // pipe(): the source has not ended before the pipe runs
  const src = Readable.from(["p", "q", "r"]);
  const dst = new PassThrough();
  const piped: string[] = [];
  await new Promise<void>((resolve) => {
    dst.on("data", (c: Buffer) => {
      piped.push(c.toString());
    });
    dst.on("end", () => resolve());
    src.pipe(dst);
    console.log("pipe-sync:", src.readableEnded, src.readableLength);
  });
  console.log("pipe:", piped.join("|"), src.readableEnded, src.readableLength);

  // an unconsumed stream destroyed early: the parked source is released
  // with the state, once
  const dropped = Readable.from(["never", "read"]);
  console.log("dropped-pre:", dropped.readableEnded, dropped.readableLength);
  dropped.destroy();
  console.log("dropped:", dropped.destroyed);
}

main().then(() => console.log("done"));
