// A `for await` over a stream costs TWO microtask turns per chunk, not one.
//
// `Readable.prototype[Symbol.asyncIterator]` is not `await stream.read()`:
// it is an `async function*` (createAsyncIterator), so a chunk that
// `read()` answers straight from the buffer still pays the wrapper's
// `yield` — AsyncGeneratorYield awaits the operand, then resolves the
// next() promise — before the loop body runs. The runtime fulfilled the
// parked next() promise the instant the buffer could answer, so every
// chunk arrived one turn early, cumulatively: chunk 1 one turn early,
// chunk 2 two, chunk 3 three.
//
// No byte comparison sees that. The bytes all arrive, in order. What moves
// is the interleaving with any other promise chain in the program, which is
// what the ruler below measures: `n` counts the turns of a self-chaining
// `Promise.resolve().then`, so each print names the turn it landed on. The
// async-generator loop is the control — it was already right, and it is the
// exact cost the stream's wrapper has to match.
import { Readable } from "node:stream";

let n = 0;
let era = 0;

function tick(k: number): void {
  if (k === era && n < 40) {
    n += 1;
    void Promise.resolve().then(() => {
      tick(k);
    });
  }
}

/** Start a fresh ruler and retire the previous one. */
function ruler(): void {
  era += 1;
  n = 0;
  const k = era;
  void Promise.resolve().then(() => {
    tick(k);
  });
}

async function* three(): AsyncGenerator<string> {
  yield "a";
  yield "b";
  yield "c";
}

async function main(): Promise<void> {
  // The control: two turns per chunk, one for the completion.
  ruler();
  for await (const c of three()) console.log("gen " + c + " @" + String(n));
  console.log("gen done @" + String(n));

  // The subject: the same cadence, off a stream whose buffer can answer
  // every read() synchronously.
  ruler();
  for await (const c of Readable.from(["a", "b", "c"])) {
    console.log("from " + String(c) + " @" + String(n));
  }
  console.log("from done @" + String(n));

  // A pushed-then-ended stream: the content is in the buffer before the
  // loop starts, so every read() answers inline here too.
  const r = new Readable({ read() {} });
  r.push("x");
  r.push("y");
  r.push(null);
  ruler();
  for await (const c of r) console.log("push " + String(c) + " @" + String(n));
  console.log("push done @" + String(n));

  // A racer queued BEFORE the loop starts: it must print between the first
  // and the second chunk, never before the first.
  ruler();
  void Promise.resolve().then(() => {
    console.log("racer @" + String(n));
  });
  for await (const c of Readable.from(["p", "q"])) {
    console.log("race " + String(c) + " @" + String(n));
  }
  console.log("race done @" + String(n));

  // A source with no chunks at all: nothing to be early about, and the
  // completion still crosses the same phase the ended path crosses.
  ruler();
  for await (const c of Readable.from([] as string[])) {
    console.log("never " + String(c));
  }
  console.log("empty done @" + String(n));
}

void main();
