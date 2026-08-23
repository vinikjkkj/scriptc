// `Readable.from(asyncGenerator)` is the parked path every time. Node's
// from() pump awaits `iterator.next()` before it can push, so the
// consumer's read() has already answered null and parked; the push then
// lands inside a microtask, and the wake — emitReadable_ — is a
// process.nextTick, which runs only once the whole microtask queue has
// drained. Every chunk of such a stream therefore arrives a PHASE after
// any promise chain the program has running, not a turn.
//
// The runtime answered the waiter from the push, in microtask time, so a
// competing generator loop that Node runs to completion first was
// interleaved with the stream's chunks instead. The bridge that made
// `Readable.from` over a generator pull (5940..5944) never saw it: its
// programs print bytes, and the bytes were right.
import { Readable } from "node:stream";

async function* letters(): AsyncGenerator<string> {
  yield "x";
  yield "y";
  yield "z";
}

async function* digits(): AsyncGenerator<string> {
  yield "1";
  yield "2";
  yield "3";
}

async function main(): Promise<void> {
  // Phase markers around the first chunk.
  process.nextTick(() => {
    console.log("  nextTick");
  });
  void Promise.resolve().then(() => {
    console.log("  microtask");
  });
  for await (const c of Readable.from(letters())) console.log("R " + String(c));
  console.log("R end");

  // A generator loop that Node finishes BEFORE the stream's first chunk:
  // seven microtask turns against a phase.
  const g = (async (): Promise<void> => {
    for await (const c of digits()) console.log("G " + c);
    console.log("G end");
  })();
  const s = (async (): Promise<void> => {
    for await (const c of Readable.from(letters())) console.log("S " + String(c));
    console.log("S end");
  })();
  await g;
  await s;

  // The array source is the OTHER shape: from()'s sync iterator pushes
  // inside the read(), so those chunks answer inline and cost two turns,
  // not a phase. Same call, same loop, different cadence.
  const g2 = (async (): Promise<void> => {
    for await (const c of digits()) console.log("g " + c);
    console.log("g end");
  })();
  const s2 = (async (): Promise<void> => {
    for await (const c of Readable.from(["x", "y", "z"])) console.log("s " + String(c));
    console.log("s end");
  })();
  await g2;
  await s2;
  console.log("done");
}

void main();
