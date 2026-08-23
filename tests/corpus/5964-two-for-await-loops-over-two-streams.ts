// Two `for await` loops over two different streams, alive at the same
// time.
//
// A per-chunk cost that is WRONG BY THE SAME AMOUNT on both loops is
// invisible when the only thing racing a stream loop is another stream
// loop: they stay in step with each other while both run ahead of
// everything else. The pairs are pinned anyway, because a change to the
// cost is exactly the kind that can put two loops over one runtime out of
// step. The MIXED pair is the discriminating one: `Readable.from(array)`
// answers its reads inline and `Readable.from(asyncGenerator)` is parked
// on every one of them, so the two cadences are a turn and a phase apart
// and their chunks have to interleave the way Node's do.
//
// The mixed pair prints CHUNKS ONLY, deliberately. Where a `for await`
// over a from() stream EXITS is governed by something else — Node gives
// `Readable.from` an asynchronous `_destroy` that awaits the source's
// `return()` before 'close', so the loop leaves a round (a generator
// source: two rounds) after this runtime leaves it. That gap is older
// than this program and is not what this program is for; putting the end
// lines of the mixed pair in here would pin it as if it were correct.
import { Readable } from "node:stream";

async function* letters(): AsyncGenerator<string> {
  yield "x";
  yield "y";
  yield "z";
}

function loop(tag: string, s: Readable): Promise<void> {
  return (async (): Promise<void> => {
    for await (const c of s) console.log(tag + " " + String(c));
    console.log(tag + " end");
  })();
}

function chunksOnly(tag: string, s: Readable): Promise<void> {
  return (async (): Promise<void> => {
    for await (const c of s) console.log(tag + " " + String(c));
  })();
}

async function main(): Promise<void> {
  // two array-sourced streams: identical cadence, so they alternate
  const a = loop("A", Readable.from(["1", "2", "3"]));
  const b = loop("B", Readable.from(["p", "q", "r"]));
  await a;
  await b;

  // two generator-sourced streams: identical again, a phase per chunk
  const c = loop("C", Readable.from(letters()));
  const d = loop("D", Readable.from(letters()));
  await c;
  await d;

  // the mixed pair, chunks only
  const e = chunksOnly("E", Readable.from(["1", "2", "3"]));
  const f = chunksOnly("F", Readable.from(letters()));
  await e;
  await f;

  // and one against a plain async-generator loop, which is neither
  const g = chunksOnly("G", Readable.from(["1", "2", "3"]));
  const h = (async (): Promise<void> => {
    for await (const v of letters()) console.log("H " + v);
  })();
  await g;
  await h;
  console.log("done");
}

void main();
