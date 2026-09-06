// `readable[Symbol.asyncIterator]()` driven by HAND, the spelling a
// streaming parser uses when it needs to pull bytes on its own schedule
// rather than let `for await` own the loop:
//
//     const it = source[Symbol.asyncIterator]()
//     while (buffered < want) { const next = await it.next(); ... }
//
// The explicit iterator and the `for await` desugar must agree chunk for
// chunk and turn for turn — they are the same pump — and both must agree
// with Node.
import { Readable } from "node:stream";

// A stream whose chunks arrive one per _read: the iterator must deliver
// them in order and stop on the push(null).
function source(items: readonly string[]): Readable {
  let i = 0;
  return new Readable({
    read(): void {
      if (i < items.length) {
        console.log("stream: pushing", items[i]);
        this.push(Buffer.from(items[i]!, "utf8"));
        i += 1;
      } else {
        console.log("stream: eof");
        this.push(null);
      }
    },
  });
}

async function byHand(): Promise<void> {
  const s = source(["alpha", "beta", "gamma"]);
  const it = s[Symbol.asyncIterator]();
  let total = 0;
  while (true) {
    const next = await it.next();
    if (next.done === true) {
      console.log("byHand: done, value is", next.value);
      break;
    }
    const chunk = next.value as Buffer;
    total += chunk.length;
    console.log("byHand: chunk", chunk.toString("utf8"), "len", chunk.length);
  }
  console.log("byHand: total", total, "destroyed", s.destroyed);
}

// The same stream through `for await`: the two spellings must print the
// same interleaving of stream and consumer lines.
async function byLoop(): Promise<void> {
  const s = source(["alpha", "beta", "gamma"]);
  let total = 0;
  for await (const chunk of s) {
    const b = chunk as Buffer;
    total += b.length;
    console.log("byLoop: chunk", b.toString("utf8"), "len", b.length);
  }
  console.log("byLoop: total", total, "destroyed", s.destroyed);
}

// A stream over a fixed array (Readable.from) read by hand — a different
// producer behind the same protocol.
async function fromArray(): Promise<void> {
  const s = Readable.from([Buffer.from("x"), Buffer.from("yz")]);
  const it = s[Symbol.asyncIterator]();
  while (true) {
    const next = await it.next();
    if (next.done === true) break;
    console.log("fromArray: chunk", (next.value as Buffer).toString("utf8"));
  }
  console.log("fromArray: end");
}

async function main(): Promise<void> {
  await byHand();
  await byLoop();
  await fromArray();
}

void main();
