// `Readable.from(asyncGenerator)`: BACK-PRESSURE, and the close that runs
// the generator's finally.
//
// Both are invisible to a test that only checks the bytes arrive. The first
// section pauses the consumer and then crosses a REAL timer boundary — a
// point both runtimes reach with every microtask and tick drained — and
// prints how far the source got. A bridge that drained the generator into
// push() would print 5 there and still deliver the same five chunks in the
// same order afterwards.
//
// The second section destroys the stream after one chunk. Node's from()
// gives the readable its own `_destroy`, which closes the ITERATOR and only
// then lets 'close' fire, so the generator's `finally` runs and it runs
// BEFORE the consumer sees the stream close.
import { Readable } from "node:stream";

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

let produced = 0;

async function* counted(): AsyncGenerator<Uint8Array, void, void> {
  for (let i = 1; i <= 5; i += 1) {
    produced = i;
    yield new Uint8Array([i]);
  }
}

async function* withFinally(): AsyncGenerator<Uint8Array, void, void> {
  try {
    yield new Uint8Array([10]);
    yield new Uint8Array([20]);
    yield new Uint8Array([30]);
  } finally {
    console.log("gen: finally");
  }
}

async function* threeMore(): AsyncGenerator<Uint8Array, void, void> {
  try {
    yield new Uint8Array([1]);
    yield new Uint8Array([2]);
    yield new Uint8Array([3]);
  } finally {
    console.log("gen: closed at " + String(seen));
  }
}

let seen = 0;

async function backpressure(): Promise<void> {
  console.log("--- back-pressure ---");
  const s = Readable.from(counted());
  console.log("before any read: produced=" + String(produced));
  await new Promise<void>((resolve) => {
    s.on("data", (chunk: Uint8Array) => {
      console.log("data " + String(chunk[0]));
      if (chunk[0] === 2) s.pause();
    });
    s.on("end", () => {
      resolve();
    });
    void (async () => {
      await sleep(50);
      console.log("paused; produced=" + String(produced));
      s.resume();
    })();
  });
  console.log("end; produced=" + String(produced));
}

async function destroyMidStream(): Promise<void> {
  console.log("--- destroy mid-stream ---");
  const s = Readable.from(withFinally());
  await new Promise<void>((resolve) => {
    s.on("data", (chunk: Uint8Array) => {
      console.log("data " + String(chunk[0]));
      if (chunk[0] === 10) s.destroy();
    });
    s.on("close", () => {
      console.log("close");
      resolve();
    });
  });
  console.log("destroyed=" + String(s.destroyed));
}

async function breakOut(): Promise<void> {
  console.log("--- break before exhaustion ---");
  for await (const chunk of Readable.from(threeMore())) {
    seen += 1;
    console.log("chunk " + String(chunk[0]));
    if (seen === 2) break;
  }
  // The close is a REQUEST, and the runtime keeps no queue for them: with a
  // pull already in flight (the loop had just taken a chunk, so the pump
  // asked for the next one) the close parks behind it, exactly as JS queues
  // `.return()` behind the pending `.next()`. Crossing a timer here reads
  // the settled state instead of racing the turn the print lands on --
  // scriptc's for-await over a stream settles two microtask turns earlier
  // than Node's async iterator, which is a divergence older than this
  // bridge (estado-bridge.md; `Readable.from([...])` shows it too).
  await sleep(50);
  console.log("after the loop, seen=" + String(seen));
}

async function main(): Promise<void> {
  await backpressure();
  await destroyMidStream();
  await breakOut();
  console.log("done");
}

void main();
