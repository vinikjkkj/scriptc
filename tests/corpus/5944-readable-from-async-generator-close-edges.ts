// `Readable.from(asyncGenerator)`: two edges of the CLOSE.
//
// 1. A generator whose `finally` YIELDS. `.return()` answers done:false and
//    leaves it suspended inside the finally -- and Node then runs the rest
//    of that finally anyway, not by design: its from() pump had already
//    gone round the loop past the push that destroyed the stream, so the
//    close is followed by exactly one more `iterator.next()`. Measured
//    against v25.9.0 with a hand-written async iterator logging each call
//    (`next#1, return(), next#2`), and reproduced under the same condition.
//    The line this program would lose without that is `gen: finally
//    continues` -- one line, no error, exit 0 either way, which is what
//    makes it worth a corpus entry.
//
// 2. A source NOBODY reads. The generator must not start: Node's from()
//    pulls only on `_read`, so `readableLength` is 0, the body never runs,
//    and crossing a timer proves nothing woke it up. It also has to tear
//    down cleanly at exit -- an unstarted generator drops its packed
//    arguments rather than abandoning a fiber.
import { Readable } from "node:stream";

// A generator whose finally YIELDS during the close: JS answers done:false
// and leaves the generator suspended; from()'s close ignores the value.
async function* yieldsInFinally(): AsyncGenerator<Uint8Array, void, void> {
  try {
    yield new Uint8Array([1]);
    yield new Uint8Array([2]);
  } finally {
    console.log("gen: finally begins");
    yield new Uint8Array([99]);
    console.log("gen: finally continues");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(() => { resolve() }, ms) });
}

async function* never(): AsyncGenerator<Uint8Array, void, void> {
  console.log("never: started");
  yield new Uint8Array([0]);
}

async function main(): Promise<void> {
  console.log("--- a finally that yields ---");
  const s = Readable.from(yieldsInFinally());
  await new Promise<void>((resolve) => {
    s.on("data", (c: Uint8Array) => {
      console.log("data " + String(c[0]));
      if (c[0] === 1) s.destroy();
    });
    s.on("close", () => { console.log("close"); resolve() });
  });

  console.log("--- a source nobody reads ---");
  const unread = Readable.from(never());
  console.log("made, readableLength=" + String(unread.readableLength));
  await sleep(30);
  console.log("still unread, destroyed=" + String(unread.destroyed));
  console.log("done");
}

void main();
