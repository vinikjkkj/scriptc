// The completion callback of a stream option callback, in every shape a
// declaration can give it: the full (error, data) tuple, a SHORT tuple
// that names only the error, and a bare zero-parameter call. Node's
// machinery passes the same arguments either way, so all three must
// behave identically — this pins the tuple the emitted *_done thunk is
// built from (lower-stream's normalizeDoneType).
//
// Its @types/node twin is tests/fixtures/node-types/streams.ts, where the
// same callbacks are declared with `data?: any` instead of `data?: Buffer
// | string`. The two must not diverge: the tuple belongs to the runtime,
// not to whichever declarations happen to be installed.
import { PassThrough, Readable, Transform, Writable } from "node:stream";

async function main(): Promise<void> {
  const out: string[] = [];

  // transform: the FULL completion tuple, passing a data argument.
  const upper = new Transform({
    transform(chunk: Buffer, _enc: string, cb: (error?: Error | null, data?: Buffer | string) => void) {
      cb(null, Buffer.from(chunk.toString("utf8").toUpperCase()));
    },
    // flush: the SHORT completion tuple — error only, no data slot.
    flush(cb: (error?: Error | null) => void) {
      out.push("<flush>");
      cb();
    },
  });

  // write/final: the completion callback contextually typed (no
  // annotation), and called with no arguments at all.
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      out.push(chunk.toString("utf8"));
      cb();
    },
    final(cb) {
      out.push("<final>");
      cb();
    },
  });

  const src = new Readable({
    read() {
      this.push(Buffer.from("ab"));
      this.push(Buffer.from("cd"));
      this.push(null);
    },
  });

  src.pipe(upper).pipe(new PassThrough()).pipe(sink);
  await new Promise<void>((resolve) => sink.on("finish", () => resolve()));
  console.log("piped:", out.join("|"));

  // A transform whose completion callback reports an ERROR through the
  // same tuple: the stream errors, the data slot is ignored.
  const boom = new Transform({
    transform(_chunk: Buffer, _enc: string, cb: (error?: Error | null, data?: Buffer | string) => void) {
      cb(new Error("nope"));
    },
  });
  boom.on("error", (e: Error) => console.log("transform error:", e.message));
  boom.write(Buffer.from("x"));
  await new Promise<void>((resolve) => setTimeout(resolve, 10));

  // destroy's completion callback: the error travels back out.
  const d = new Readable({
    read() {},
    destroy(err: Error | null, cb: (error?: Error | null) => void) {
      out.push(err === null ? "destroy:clean" : `destroy:${err.message}`);
      cb(err);
    },
  });
  d.on("error", (e: Error) => console.log("destroy error:", e.message));
  d.destroy(new Error("bye"));
  console.log("tail:", out.slice(-1).join(""), "destroyed:", d.destroyed);
}

void main();
