// `Readable.from(asyncGenerator)` under `pipe`, and two of them alive at
// once.
//
// pipe() is the consumer that puts the stream in FLOWING mode, which is the
// other half of the push path: a chunk that arrives while the buffer is
// empty and a destination is attached is emitted directly instead of
// buffered, and the pump's decision to pull again reads the answer from
// that branch. The generator's "exhausted" line lands between the last
// write and 'finish' in Node, which is what says the source is drained by
// the destination rather than ahead of it.
//
// Two sources at once is the RE-ENTRANCY question: every settlement runs on
// the main stack a microtask out, so two pumps interleave instead of
// nesting. Their lines alternate here, and one finishing does not disturb
// the other.
import { Readable, Writable } from "node:stream";

async function* src(tag: string, n: number): AsyncGenerator<Uint8Array, void, void> {
  for (let i = 1; i <= n; i += 1) {
    yield new Uint8Array([i]);
  }
  console.log(tag + ": exhausted");
}

async function main(): Promise<void> {
  console.log("--- pipe ---");
  const sink = new Writable({
    write(chunk: Buffer, _enc: string, cb: (e?: Error | null) => void): void {
      console.log("wrote " + String(chunk[0]));
      cb();
    },
  });
  await new Promise<void>((resolve) => {
    sink.on("finish", () => {
      console.log("finish");
      resolve();
    });
    Readable.from(src("a", 3)).pipe(sink);
  });

  console.log("--- two at once ---");
  const one = Readable.from(src("one", 2));
  const two = Readable.from(src("two", 2));
  await new Promise<void>((resolve) => {
    let done = 0;
    const fin = (): void => {
      done += 1;
      if (done === 2) resolve();
    };
    one.on("data", (c: Uint8Array) => { console.log("one " + String(c[0])) });
    two.on("data", (c: Uint8Array) => { console.log("two " + String(c[0])) });
    one.on("end", fin);
    two.on("end", fin);
  });
  console.log("done");
}

void main();
