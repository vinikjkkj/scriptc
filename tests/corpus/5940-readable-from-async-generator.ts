// `Readable.from(asyncGenerator)` — the stream bridge.
//
// Node's from() wraps the source in a PULL loop: one `iterator.next()` per
// `_read`, and it stops as soon as `push()` answers false. So the generator
// runs INTERLEAVED with the consumer, not ahead of it, and every section
// below prints from both sides so a bridge that drained the source eagerly
// would print the same bytes in a different order — the failure a
// content-only assertion cannot see.
import { Readable } from "node:stream";

async function* three(): AsyncGenerator<Uint8Array, void, void> {
  console.log("gen: enter");
  yield new Uint8Array([1, 2]);
  console.log("gen: after 1");
  yield new Uint8Array([3, 4]);
  console.log("gen: after 2");
  yield new Uint8Array([5]);
  console.log("gen: leave");
}

async function* empty(): AsyncGenerator<Uint8Array, void, void> {
  console.log("empty: enter");
}

async function delayed(n: number): Promise<number> {
  return n * 10;
}

// An `await` between yields: the generator parks on a real promise, so the
// consumer's own await spans an extra turn per chunk.
async function* awaiting(): AsyncGenerator<Uint8Array, void, void> {
  for (const n of [1, 2]) {
    const v = await delayed(n);
    console.log("gen: computed " + String(v));
    yield new Uint8Array([v]);
  }
}

async function* words(): AsyncGenerator<string, void, void> {
  yield "alpha";
  yield "beta";
}

function show(chunk: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < chunk.length; i += 1) parts.push(String(chunk[i]));
  return "[" + parts.join(",") + "]";
}

async function main(): Promise<void> {
  console.log("--- for await ---");
  for await (const chunk of Readable.from(three())) {
    console.log("consumer: " + show(chunk));
  }

  console.log("--- empty source ---");
  let n = 0;
  for await (const chunk of Readable.from(empty())) {
    console.log("consumer: " + show(chunk));
    n += 1;
  }
  console.log("chunks seen: " + String(n));

  // An `await` inside the body, consumed in FLOWING mode. The consumer
  // is a 'data' listener rather than a `for await` on purpose: scriptc's
  // for-await-over-a-stream desugar settles two microtask turns earlier
  // than Node's async iterator does (which is itself an async generator,
  // and pays a yield hop) — a divergence that predates this bridge and
  // that `Readable.from([...])` shows just as well. It is invisible until
  // a source parks on a promise between chunks, which is exactly this
  // generator; consuming through 'data' keeps the section about the
  // BRIDGE. The gap is written up in estado-bridge.md.
  console.log("--- awaiting body ---");
  await new Promise<void>((resolve) => {
    const a = Readable.from(awaiting());
    a.on("data", (chunk: Uint8Array) => {
      console.log("consumer: " + show(chunk));
    });
    a.on("end", () => {
      resolve();
    });
  });

  console.log("--- string yields ---");
  for await (const chunk of Readable.from(words())) {
    console.log("consumer: " + String(chunk));
  }

  console.log("--- data events ---");
  const s = Readable.from(three());
  await new Promise<void>((resolve) => {
    s.on("data", (chunk: Uint8Array) => {
      console.log("data: " + show(chunk));
    });
    s.on("end", () => {
      console.log("end");
      resolve();
    });
  });

  console.log("done");
}

void main();
