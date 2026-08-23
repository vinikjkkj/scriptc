// The turn ruler behind tests/harness/for-await-stream-turns.test.ts.
//
// `n` counts the turns of a self-chaining `Promise.resolve().then`, and
// each line names the turn its chunk landed on — so the assertion in the
// test is a COUNT, not an interleaving, and a regression reads as "the
// buffered chunk costs 1 turn, expected 2". One loop per state Node's
// iterator read() can be in: the async generator (the control, and the
// exact cost the stream's own `async function*` wrapper has to match),
// a stream whose buffer answers inline, and a stream that is parked when
// the chunk turns up.
import { Readable } from "node:stream";

let n = 0;
let era = 0;

function tick(k: number): void {
  if (k === era && n < 12) {
    n += 1;
    void Promise.resolve().then(() => {
      tick(k);
    });
  }
}

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
  ruler();
  for await (const c of three()) console.log("gen " + c + " @" + String(n));

  ruler();
  for await (const c of Readable.from(["a", "b", "c"])) {
    console.log("inline " + String(c) + " @" + String(n));
  }

  const r = new Readable({ read() {} });
  setTimeout(() => {
    ruler();
    r.push("p");
    r.push(null);
  }, 5);
  for await (const c of r) console.log("parked " + String(c) + " @" + String(n));
}

void main();
