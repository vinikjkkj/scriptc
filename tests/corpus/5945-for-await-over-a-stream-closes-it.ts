// Leaving a `for await` over a stream EARLY closes the stream.
//
// Node's `Readable.prototype[Symbol.asyncIterator]` runs its whole loop
// inside a try/finally that destroys the stream on the way out
// (`destroyOnReturn` defaults on), so a `break` — or a `return` or a throw
// out of the loop body — ends the stream. scriptc had no close at all: the
// program below read `destroyed=false` where Node reads true, on the
// SHIPPED `Readable.from(array)` path, and nothing in this corpus covered
// it.
//
// The source here is an array on purpose. That is the path the divergence
// was found on, it needs no generator to show, and it keeps this program a
// test of the LOOP rather than of the bridge (the generator sources are
// 5940..5944). What the loop's close buys once a source CAN hold user code
// is a `finally` block that runs — the same silent loss a merge fixed for
// `for-of` over a generator.
import { Readable } from "node:stream";

async function breakOut(): Promise<void> {
  const s = Readable.from(["a", "b", "c"]);
  for await (const c of s) {
    console.log("chunk " + String(c));
    break;
  }
  console.log("break: destroyed=" + String(s.destroyed) + " readable=" + String(s.readable));
}

async function returnOut(): Promise<string> {
  const s = Readable.from(["d", "e"]);
  try {
    for await (const c of s) {
      return "returned at " + String(c);
    }
    return "never";
  } finally {
    console.log("return: destroyed=" + String(s.destroyed));
  }
}

async function throwOut(): Promise<void> {
  const s = Readable.from(["f", "g"]);
  try {
    for await (const c of s) {
      throw new Error("out at " + String(c));
    }
  } catch (e) {
    console.log("caught " + (e instanceof Error ? e.message : "?"));
  }
  console.log("throw: destroyed=" + String(s.destroyed));
}

// The control: a loop that runs to exhaustion needs no special case — the
// stream has already autoDestroyed by the time the close would run, and
// Node's own destroy is the same no-op there.
async function exhaust(): Promise<void> {
  const s = Readable.from(["h"]);
  for await (const c of s) {
    console.log("chunk " + String(c));
  }
  console.log("exhausted: destroyed=" + String(s.destroyed));
}

async function main(): Promise<void> {
  await breakOut();
  console.log(await returnOut());
  await throwOut();
  await exhaust();
  console.log("done");
}

void main();
